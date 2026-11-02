# Local versioned profile API

This adapter wraps the installed `ad44b2c…` routing core with FastAPI/Uvicorn on
`127.0.0.1:8002`. It does not replace ports 8000/8001, change Nginx, open firewall
ports or modify the database. The matching browser adapter is prepared in
`scripts/profile-routing-v1.mjs` and is not included in the public app bundle.

Supported: Standard, wheelchair and power wheelchair, balanced/Direct only.
`contract_version: 1` requests use the existing browser's preset options and
tiers. Preset overrides are rejected. Relaxation is off unless explicitly true;
inconclusive candidate searches remain inconclusive. Responses retain original
oriented pieces, unknown values, coverage, effective rules and profile times.

`/capabilities` advertises `production_ready: false` and `local-preview`.
The client requires an explicit preview context to accept it. This is a bounded
transport upgrade, not a production or citywide parity claim. No shadow capability
is advertised. Other profiles need their additional attributes and cost rules.

Install with the generated `install_sonnenpfad_profile_v2.py` on Oracle. The
installer verifies all three source module hashes, tests the new ASGI transport,
and creates only the separate stage-2 directory and systemd service. It installs
no dependencies. Use the versions already available to the existing API.
It performs three route requests through the new endpoint and compares Standard
to the still-running API 0.2. A metadata-only source-column inventory follows.

Stop this preview with `sudo systemctl disable --now sonnenpfad-profile-v2`.
Publication and frontend activation remain separate steps requiring acceptance.
