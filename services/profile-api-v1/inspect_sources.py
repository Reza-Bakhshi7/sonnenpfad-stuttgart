"""Read-only column inventory for the remaining mobility profile attributes."""
import contextlib
import json
from profile_api import connect

with contextlib.closing(connect()) as connection, connection.cursor() as cursor:
    cursor.execute("""SELECT table_schema,table_name,column_name,data_type
      FROM information_schema.columns
      WHERE table_schema='routing' AND
       (column_name ~* '(bench|shelter|crossing|tactile|handrail|conveying|width|wheelchair)'
        OR table_name ~* '(poi|bench|shelter|crossing)')
      ORDER BY table_name,ordinal_position""")
    print('PROFILE_DATA_SOURCES: '+json.dumps(cursor.fetchall(),ensure_ascii=False),flush=True)
