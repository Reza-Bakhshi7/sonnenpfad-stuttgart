"""Versioned ASGI transport for the reviewed routing core; local preview only."""
import asyncio
import copy
import json
import threading
from datetime import datetime

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

import profile_api as core
from sonnenpfad_profile_rules import relaxation_tiers, resolved_options

VERSION = '0.3.0-preview.2'
MAX_BODY = 16384
HEADERS = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}


def fail(status, code, message):
    raise core.RouteError(status, code, message)


def identical(value, expected):
    """JSON true is not the number 1; compare nested preset values strictly."""
    if isinstance(expected, bool):
        return type(value) is bool and value == expected
    if isinstance(expected, (int, float)):
        return core.finite(value) and value == expected
    if isinstance(expected, dict):
        return isinstance(value, dict) and set(value) == set(expected) and all(identical(value[k], v) for k, v in expected.items())
    if isinstance(expected, list):
        return isinstance(value, list) and len(value) == len(expected) and all(identical(a, b) for a, b in zip(value, expected))
    return type(value) is type(expected) and value == expected


def validate_contract(body):
    if not isinstance(body, dict):
        fail(422, 'invalid_request', 'Expected a JSON object')
    required = {'contract_version', 'start', 'end', 'max_snap_m', 'include_segments', 'preference', 'mobility_profile', 'options', 'time', 'timezone', 'leaf_on', 'tiers'}
    if set(body) - required - {'allow_relaxation'} or required - set(body):
        fail(422, 'unsupported_fields', 'Missing or unsupported versioned request fields')
    if type(body['contract_version']) is not int or body['contract_version'] != 1 or body['include_segments'] is not True:
        fail(422, 'unsupported_contract', 'Contract 1 with segment metadata is required')
    legacy = core.validate_request({key: body[key] for key in ('start', 'end', 'max_snap_m', 'preference', 'mobility_profile')} | {'allow_relaxation': body.get('allow_relaxation', False)})
    if body['timezone'] != 'Europe/Berlin' or type(body['leaf_on']) is not bool:
        fail(422, 'invalid_context', 'Invalid timezone or leaf state')
    if body['time'] is not None:
        try:
            if not isinstance(body['time'], str) or len(body['time']) > 40 or datetime.fromisoformat(body['time'].replace('Z', '+00:00')).tzinfo is None:
                raise ValueError()
        except (ValueError, TypeError):
            fail(422, 'invalid_time', 'Time must be null or an ISO timestamp with offset')
    expected = resolved_options({'mobilityProfile': legacy['mobility_profile'], 'preference': 'balanced'})
    options = body['options']
    if not isinstance(options, dict):
        fail(422, 'invalid_options', 'Expected preset options')
    options = dict(options)
    # solarWeight has no cost effect for balanced routes, but remains a known,
    # bounded field shared with the browser contract. It is never client SQL.
    if 'solarWeight' in options:
        weight = options.pop('solarWeight')
        if not core.finite(weight) or not 0 <= weight <= 1:
            fail(422, 'invalid_options', 'Invalid solar weight')
        expected_tier_options = expected | {'solarWeight': weight}
    else:
        expected_tier_options = expected
    if not identical(options, expected):
        fail(422, 'unsupported_options', 'Preset overrides are not supported')
    expected_tiers = relaxation_tiers(expected_tier_options)
    if not identical(body['tiers'], expected_tiers):
        fail(422, 'invalid_tiers', 'Relaxation tiers do not match the preset')
    return legacy


def adapt_response(data, request):
    result = copy.deepcopy(data)
    p = result.get('properties', {})
    if result.get('type') != 'FeatureCollection' or p.get('requested_profile') != request['mobility_profile'] or p.get('segment_metadata_version') != 1:
        raise ValueError('Invalid core route contract')
    tiers = relaxation_tiers({'mobilityProfile': request['mobility_profile'], 'preference': 'balanced'})
    level = p.get('fallback_level')
    if type(level) is not int or not 0 <= level < len(tiers) or (level and not request['allow_relaxation']):
        raise ValueError('Unpermitted relaxation')
    tier = tiers[level]
    if not identical(p.get('effective_options'), tier['options']) or not identical(p.get('relaxed_criteria'), tier['relaxed_criteria']):
        raise ValueError('Invalid effective policy')
    segments = p.get('segments')
    if not isinstance(segments, list) or not segments or p.get('shade') is not None:
        raise ValueError('Missing route pieces or unsupported exposure')
    p.update(profile_contract_version=1, preference='balanced', route_parts=len(segments),
             time_model={'speedMpm': tier['options']['speedMpm'], 'ascentMinutesPer10m': tier['options']['ascentMinutesPer10m'], 'estimated': True})
    json.dumps(result, allow_nan=False)
    return result


def capabilities():
    return dict(api_version=VERSION, profile_contract_version=1, segment_metadata_version=1,
                topology='audited-osm-nodes', mobility_profiles=list(core.SUPPORTED),
                preferences=['balanced'], shadow_model=None, strict_by_default=True,
                explicit_relaxation=True, preset_overrides=False, max_snap_m=50,
                deployment_stage='local-preview', production_ready=False, route_parity_verified=False,
                gap_supplement=dict(core.SUPPLEMENT['stats'], routing_reference=core.SUPPLEMENT['routingReference'])
                if core.SUPPLEMENT else None,
                reference_commit=core.REFERENCE_COMMIT)


def strict_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON field')
            result[key] = value
        return result
    def invalid(_value):
        raise ValueError('Non-finite JSON')
    return json.loads(data, object_pairs_hook=pairs, parse_constant=invalid)


def create_app(calculator=core.calculate_route):
    app = FastAPI(title='Sonnenpfad profile preview', version=VERSION, docs_url=None, redoc_url=None, openapi_url=None)
    slot = threading.BoundedSemaphore(1)
    app.state.slot = slot

    @app.get('/health')
    async def health():
        return JSONResponse(dict(status='running', api_version=VERSION, database_checked=False, production_ready=False), headers=HEADERS)

    @app.get('/capabilities')
    async def get_capabilities():
        return JSONResponse(capabilities(), headers=HEADERS)

    @app.post('/v1/route')
    async def route(request: Request):
        acquired = False
        try:
            if request.headers.get('content-type', '').split(';')[0].strip().lower() != 'application/json':
                fail(415, 'content_type', 'Use application/json')
            if 'content-length' in request.headers:
                try:
                    length = int(request.headers['content-length'])
                except ValueError:
                    fail(400, 'invalid_length', 'Invalid Content-Length')
                if not 0 < length <= MAX_BODY:
                    fail(413, 'body_size', 'Request body missing or too large')

            async def read_body():
                chunks, size = [], 0
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > MAX_BODY:
                        fail(413, 'body_size', 'Request body too large')
                    chunks.append(chunk)
                return b''.join(chunks)
            try:
                raw = await asyncio.wait_for(read_body(), timeout=5)
                body = strict_json(raw)
            except (ValueError, UnicodeDecodeError, RecursionError):
                fail(400, 'invalid_json', 'Invalid JSON')
            legacy = validate_contract(body)
            acquired = slot.acquire(blocking=False)
            if not acquired:
                fail(503, 'busy', 'Routing is busy; retry shortly')
            def compute():
                try:
                    return adapt_response(calculator(legacy), legacy)
                finally:
                    slot.release()
            pending = asyncio.get_running_loop().run_in_executor(None, compute)
            # A disconnected client must not free the slot while its SQL still
            # runs. Shield the job and release only inside the worker thread.
            acquired = False
            pending.add_done_callback(lambda job: job.exception() if not job.cancelled() else None)
            return JSONResponse(await asyncio.shield(pending), headers=HEADERS)
        except core.RouteError as error:
            return JSONResponse({'error': error.code, 'message': str(error)}, status_code=error.status, headers=HEADERS)
        except (asyncio.TimeoutError, TimeoutError):
            return JSONResponse({'error': 'timeout'}, status_code=408, headers=HEADERS)
        except Exception as error:
            code = getattr(error, 'pgcode', None)
            # Do not expose SQL, endpoints, credentials or database diagnostics.
            print('Profile request failed: ' + type(error).__name__ + ' ' + str(code or ''), flush=True)
            return JSONResponse({'error': 'database_timeout' if code == '57014' else 'routing_unavailable'}, status_code=504 if code == '57014' else 503, headers=HEADERS)
        finally:
            if acquired:
                slot.release()
    return app


app = create_app()
