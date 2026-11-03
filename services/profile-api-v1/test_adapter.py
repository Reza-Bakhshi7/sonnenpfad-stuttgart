import asyncio
import copy
import json
import threading
import unittest
from unittest.mock import patch

import app as service
from sonnenpfad_profile_rules import resolved_options, relaxation_tiers


CUSTOM = dict(avoidSteps=True, avoidEscalators=False, avoidPoorSurface=True, avoidWheelchairNo=False, slopeMode='uphill',
              unknownFactor=.45, speedMpm=75, ascentMinutesPer10m=1)


def payload(profile='wheelchair', relax=False, weight=None, preference='balanced', time=None):
    options = resolved_options({'mobilityProfile': profile, 'preference': preference, **(CUSTOM if profile == 'custom' else {})})
    if weight is not None:
        options['solarWeight'] = weight
    return dict(contract_version=1, start=[9.18,48.77], end=[9.181,48.771],
                max_snap_m=50, include_segments=True, mobility_profile=profile,
                preference=preference, options=options, time=time,
                timezone='Europe/Berlin', leaf_on=True, tiers=relaxation_tiers(options),
                allow_relaxation=relax)


def response(profile='wheelchair', level=0):
    tier = relaxation_tiers({'mobilityProfile': profile, 'preference': 'balanced'})[level]
    return dict(type='FeatureCollection', features=[dict(type='Feature', properties={},
                geometry=dict(type='LineString', coordinates=[[9.18,48.77],[9.181,48.771]]))],
                properties=dict(requested_profile=profile, fallback_level=level,
                effective_options=tier['options'], relaxed_criteria=tier['relaxed_criteria'],
                segment_metadata_version=1, shade=None, segments=[{'length_m':100}]))


async def invoke(app, method='POST', path='/v1/route', body=None, raw=None, headers=None):
    encoded = json.dumps(payload() if body is None else body).encode() if raw is None else raw
    headers = [(b'content-type', b'application/json')] if headers is None else headers
    messages = []
    received = False
    async def receive():
        nonlocal received
        if received:
            return {'type':'http.disconnect'}
        received = True
        return {'type':'http.request', 'body':encoded, 'more_body':False}
    async def send(message):
        messages.append(message)
    await app({'type':'http', 'asgi':{'version':'3.0'}, 'http_version':'1.1',
               'scheme':'http', 'method':method, 'path':path, 'raw_path':path.encode(),
               'query_string':b'', 'headers':headers, 'client':('127.0.0.1',1234),
               'server':('127.0.0.1',8002), 'root_path':''}, receive, send)
    start = next(m for m in messages if m['type']=='http.response.start')
    data = b''.join(m.get('body',b'') for m in messages if m['type']=='http.response.body')
    return start['status'], json.loads(data), dict(start['headers'])


class ContractTests(unittest.TestCase):
    def test_all_profiles_and_weather_context(self):
        for profile in service.engine.SUPPORTED:
            for weight in [None,0,.5,1]:
                result=service.validate_contract(payload(profile,weight=weight))
                self.assertEqual(result['mobility_profile'],profile)
                self.assertFalse(result['allow_relaxation'])
                self.assertEqual(result['solar_weight'],weight)

    def test_custom_accepts_only_switches_and_fixed_numbers(self):
        self.assertEqual(service.validate_contract(payload('custom'))['options']['slopeMode'],'uphill')
        for key,value in [('avoidSteps',1),('slopeMode','sideways'),('unknownFactor',0),('maxSlope',4),('speedMpm',90)]:
            body=payload('custom');body['options'][key]=value;body['tiers']=relaxation_tiers(body['options'])
            with self.assertRaises(service.core.RouteError):service.validate_contract(body)

    def test_reject_overrides_and_forged_tiers(self):
        for key, value in [('avoidSteps',False),('maxSlope',100),('speedMpm',True),('unknownField',1)]:
            body=payload();body['options'][key]=value
            with self.assertRaises(service.core.RouteError):service.validate_contract(body)
        body=payload();body['tiers'][-1]['relaxed_criteria']=[]
        with self.assertRaises(service.core.RouteError):service.validate_contract(body)

    def test_unsupported_profiles_preferences_and_numeric_boolean(self):
        for key,value in [('mobility_profile','skateboard'),('preference','shade'),('contract_version',True),('max_snap_m',True),('leaf_on',1),('allow_relaxation','true'),('extra',1)]:
            body=payload();body[key]=value
            with self.assertRaises(service.core.RouteError):service.validate_contract(body)

    def test_sun_and_shade_need_a_time(self):
        for preference in ('shade','sun'):
            with self.assertRaises(service.core.RouteError):service.validate_contract(payload('standard',preference=preference))
            result=service.validate_contract(payload('stroller',preference=preference,time='2026-06-21T11:00:00.000Z'))
            self.assertEqual((result['preference'],result['time_ms'],result['leaf_on']),(preference,1782039600000.0,True))

    def test_optional_context_is_validated(self):
        for value in ['', '2026-11-02', 'garbage', 123]:
            body=payload();body['time']=value
            with self.assertRaises(service.core.RouteError):service.validate_contract(body)
        body=payload();body['time']='2026-11-02T14:00:00Z';service.validate_contract(body)

    def test_strict_response_cannot_smuggle_relaxation(self):
        request=service.validate_contract(payload())
        with self.assertRaises(ValueError):service.adapt_response(response(level=1),request)
        request=service.validate_contract(payload(relax=True))
        actual=service.adapt_response(response(level=1),request)
        self.assertEqual(actual['properties']['relaxed_criteria'],['maxSlope'])
        self.assertEqual(actual['properties']['time_model']['speedMpm'],60)


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_metadata_and_calculator_request(self):
        calls=[]
        def calculate(body):calls.append(body);return response(body['mobility_profile'])
        app=service.create_app(calculate)
        status,data,headers=await invoke(app)
        self.assertEqual(status,200)
        self.assertEqual(data['properties']['profile_contract_version'],1)
        self.assertEqual(data['properties']['route_parts'],1)
        self.assertEqual(headers[b'cache-control'],b'no-store')
        self.assertEqual(set(calls[0]),{'start','end','mobility_profile','preference','max_snap_m','allow_relaxation','options','solar_weight','time_ms','leaf_on'})

    async def test_no_unaccepted_production_capability(self):
        status,data,_=await invoke(service.create_app(),method='GET',path='/capabilities')
        self.assertEqual(status,200);self.assertIs(data['production_ready'],service.PRODUCTION_READY)
        self.assertEqual(data['deployment_stage'],'production' if service.PRODUCTION_READY else 'local-preview')
        self.assertEqual(data['preferences'],['balanced','shade','sun']);self.assertEqual(data['shadow_model'],'geometric-time-aware')

    async def test_body_limits_bad_json_and_type(self):
        app=service.create_app(lambda _:self.fail('Invalid body reached SQL'))
        for raw,headers,expected in [(b'{}',[],415),(b'x'*17000,None,413),(b'{"x":NaN}',None,400),(b'{"x":1,"x":2}',None,400),(b'{',None,400)]:
            status,_,_=await invoke(app,raw=raw,headers=headers)
            self.assertEqual(status,expected)

    async def test_errors_are_sanitized_and_slot_reusable(self):
        def calculate(_):raise RuntimeError('password=private SQL and coordinates')
        app=service.create_app(calculate)
        for _ in range(2):
            status,data,_=await invoke(app)
            self.assertEqual(status,503);self.assertNotIn('private',json.dumps(data))

    async def test_inconclusive_search_is_not_changed_to_no_route(self):
        def calculate(_):raise service.core.RouteError(409,'candidate_search_limited','Search was inconclusive')
        status,data,_=await invoke(service.create_app(calculate))
        self.assertEqual(status,409);self.assertEqual(data['error'],'candidate_search_limited')

    async def test_cancelled_client_does_not_free_live_sql_slot(self):
        started=threading.Event();release=threading.Event()
        def calculate(_):started.set();release.wait(3);return response()
        app=service.create_app(calculate,slots=1,queue_seconds=.2);first=asyncio.create_task(invoke(app))
        await asyncio.to_thread(started.wait,2)
        first.cancel()
        with self.assertRaises(asyncio.CancelledError):await first
        status,data,_=await invoke(app)
        self.assertEqual(status,503);self.assertEqual(data['error'],'busy')
        release.set()
        for _ in range(100):
            if not app.state.slot.locked():break
            await asyncio.sleep(.01)
        else:self.fail('SQL slot was not released after work completed')
        status,_,_=await invoke(app);self.assertEqual(status,200)

    async def test_waiting_request_is_served_after_the_running_one(self):
        started=threading.Event();release=threading.Event()
        def calculate(_):started.set();release.wait(3);return response()
        app=service.create_app(calculate,slots=1,queue_seconds=3);first=asyncio.create_task(invoke(app))
        await asyncio.to_thread(started.wait,2)
        second=asyncio.create_task(invoke(app));await asyncio.sleep(.2)
        self.assertFalse(second.done(),'the second request waits instead of failing')
        release.set()
        self.assertEqual((await first)[0],200);self.assertEqual((await second)[0],200)


if __name__=='__main__':unittest.main(verbosity=2)
