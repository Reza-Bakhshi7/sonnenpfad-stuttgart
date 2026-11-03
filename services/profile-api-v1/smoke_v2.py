"""Acceptance of the new local transport, not a repeat of core self-tests."""
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from test_adapter import payload
from app import PRODUCTION_READY
import profile_api as sql_engine
from sonnenpfad_profile_rules import resolved_options

BASE='http://127.0.0.1:8002/'
START=[9.1703775,48.7727873]
END=[9.1630688,48.7708607]


def request(url, body=None):
    raw=None if body is None else json.dumps(body,allow_nan=False).encode()
    request=urllib.request.Request(url,data=raw,headers={'Content-Type':'application/json','Accept':'application/json'})
    try:
        with urllib.request.urlopen(request,timeout=45) as response:
            return response.status,json.load(response)
    except urllib.error.HTTPError as error:
        return error.code,json.load(error)


def main():
    status,health=request(BASE+'health')
    assert status==200 and health['api_version']=='0.3.1'
    status,caps=request(BASE+'capabilities')
    assert status==200 and caps['production_ready'] is PRODUCTION_READY and caps['shadow_model']=='geometric-time-aware'
    gap=caps['gap_supplement'];assert gap and gap['atlasWays']>0 and gap['pieces']>0
    assert caps['mobility_profiles']==['standard','wheelchair','powerWheelchair','walkingAid','vision','stroller','custom']
    assert caps['routing_engine']=='in-memory'
    invalid=payload();invalid['unknown_field']=True
    status,error=request(BASE+'v1/route',invalid)
    assert status==422 and error['error']=='unsupported_fields'
    standard=None
    for profile in caps['mobility_profiles']:
        body=payload(profile);body['start']=START;body['end']=END
        started=time.monotonic();status,data=request(BASE+'v1/route',body)
        assert status==200,(profile,status,data.get('error'))
        p=data['properties']
        assert p['requested_profile']==profile and p['profile_contract_version']==1
        assert p['relaxed_criteria']==[] and p['fallback_level']==0
        assert p['route_parts']==len(p['segments']) and p['shade'] is None
        assert p['time_model']['speedMpm']==body['options']['speedMpm']
        if profile in sql_engine.SUPPORTED:
            # The in-memory engine must reproduce the reviewed SQL/pgRouting engine exactly.
            reference=sql_engine.calculate_route(dict(start=START,end=END,mobility_profile=profile,max_snap_m=50))['properties']
            assert abs(reference['distance_m']-p['distance_m'])<=.02,(profile,reference['distance_m'],p['distance_m'])
        if profile=='standard':standard=p
        print(json.dumps({'profile':profile,'transport':'PASS','distance_m':p['distance_m'],
                          'seconds':round(time.monotonic()-started,3)},ensure_ascii=False),flush=True)
    query=urllib.parse.urlencode(dict(start_lon=START[0],start_lat=START[1],end_lon=END[0],end_lat=END[1],profile='shortest',max_snap_m=50,include_segments='true'))
    status,old=request('http://127.0.0.1:8000/route?'+query)
    # API 0.2 lacks the gap ways: Standard may only be shorter, and only via a supplement edge.
    base_max=json.loads(pathlib.Path(__file__).with_name('gap_supplement.json').read_text())['baseMaxEdge']
    supplement_used=any(s['edge_id']>base_max for s in standard['segments'])
    assert status==200 and standard['distance_m']<=old['properties']['distance_m']+.02
    assert supplement_used or abs(old['properties']['distance_m']-standard['distance_m'])<=.02
    print(json.dumps({'standard_m':standard['distance_m'],'api_0_2_m':old['properties']['distance_m'],'gap_ways_used':supplement_used}),flush=True)
    # Sun and shade at midsummer noon: real shares, and the shade route is at least as shaded as the sun route.
    shares={}
    for preference in ('balanced','shade','sun'):
        body=payload('standard',preference=preference,time='2026-06-21T11:00:00.000Z');body['start']=START;body['end']=END
        started=time.monotonic();status,data=request(BASE+'v1/route',body)
        assert status==200,(preference,status,data.get('error'))
        p=data['properties'];assert p['preference']==preference and 0<=p['shade']<=1
        shares[preference]=p['shade']
        print(json.dumps({'preference':preference,'distance_m':p['distance_m'],'shade':p['shade'],'seconds':round(time.monotonic()-started,3)}),flush=True)
    assert shares['shade']>=shares['sun'],shares
    # A search hit inside the Stuttgart 21 construction site (about 90 m from any way) still gets a route.
    body=payload('wheelchair',relax=True);body['start']=[9.1833959,48.7856099];body['end']=[9.17935,48.77845]
    status,data=request(BASE+'v1/route',body)
    assert status==200 and data['properties']['snap_widened'] is True and data['properties']['start_snap_distance_m']>50,(status,data.get('error'))
    print(json.dumps({'far_start_snap_m':data['properties']['start_snap_distance_m'],'distance_m':data['properties']['distance_m']}),flush=True)
    print('PROFILE_V2_TRANSPORT_PASS: all seven profiles; engine equals the SQL engine; sun/shade routes; Standard equals API 0.2 or is shorter via restored atlas ways.',flush=True)
    print('Local preview only. Citywide and public-browser acceptance remain open.',flush=True)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print('PROFILE_V2_TRANSPORT_FAIL: '+str(error),flush=True);sys.exit(1)
