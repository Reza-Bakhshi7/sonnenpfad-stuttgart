#!/usr/bin/env python3
"""Collect server health for the Sonnenpfad admin dashboard (every 5 minutes, systemd timer).

Writes /var/lib/sonnenpfad-metrics/latest.json, served by Nginx at /ops/metrics only with the
X-Ops-Token header. Standard library only; reads /proc, systemctl, PostgreSQL and the
IP-free API timing log (/var/log/nginx/sonnenpfad-api-metrics.log: msec status request_time uri).
"""
import json, os, subprocess, time
from datetime import datetime, timezone

STATE = "/var/lib/sonnenpfad-metrics"
API_LOG = "/var/log/nginx/sonnenpfad-api-metrics.log"
SERVICES = ["sonnenpfad-profile-v2", "nginx", "postgresql", "sonnenpfad-backup.timer"]
HISTORY_DAYS = 7


def run(*args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:
        return ""


def cpu_percent():
    def sample():
        with open("/proc/stat") as f:
            values = [int(v) for v in f.readline().split()[1:]]
        return values[3] + values[4], sum(values)
    idle1, total1 = sample(); time.sleep(1); idle2, total2 = sample()
    return round(100 * (1 - (idle2 - idle1) / max(1, total2 - total1)), 1)


def memory():
    info = {}
    with open("/proc/meminfo") as f:
        for line in f:
            key, value = line.split(":", 1)
            info[key] = int(value.split()[0])
    total, available = info["MemTotal"] / 1024, info["MemAvailable"] / 1024
    return {"total_mb": round(total), "used_mb": round(total - available), "pct": round(100 * (total - available) / total, 1)}


def disk():
    stat = os.statvfs("/")
    total, free = stat.f_blocks * stat.f_frsize, stat.f_bavail * stat.f_frsize
    return {"total_gb": round(total / 1e9, 1), "used_gb": round((total - free) / 1e9, 1), "pct": round(100 * (total - free) / total, 1)}


def network(previous):
    rx = tx = 0
    with open("/proc/net/dev") as f:
        for line in f.readlines()[2:]:
            name, data = line.split(":", 1)
            if name.strip() == "lo":
                continue
            fields = data.split()
            rx += int(fields[0]); tx += int(fields[8])
    now = time.time()
    rates = {"rx_kbs": 0, "tx_kbs": 0}
    if previous and now > previous["t"] and rx >= previous["rx"]:
        span = now - previous["t"]
        rates = {"rx_kbs": round((rx - previous["rx"]) / span / 1024, 1), "tx_kbs": round((tx - previous["tx"]) / span / 1024, 1)}
    return rates, {"t": now, "rx": rx, "tx": tx}


def database():
    size = run("sudo", "-u", "postgres", "psql", "-Atc", "SELECT pg_database_size('sonnenpfad')")
    connections = run("sudo", "-u", "postgres", "psql", "-Atc", "SELECT count(*) FROM pg_stat_activity WHERE datname = 'sonnenpfad'")
    return {"size_mb": round(int(size or 0) / 1048576, 1), "connections": int(connections or 0)}


def api(now):
    since, times, statuses = now - 3600, [], {}
    try:
        with open(API_LOG) as f:
            for line in f:
                parts = line.split()
                if len(parts) < 4 or float(parts[0]) < since:
                    continue
                statuses[parts[1]] = statuses.get(parts[1], 0) + 1
                if parts[3].endswith("/v1/route"):
                    times.append(float(parts[2]) * 1000)
    except FileNotFoundError:
        pass
    times.sort()
    pick = lambda q: round(times[min(len(times) - 1, int(q * len(times)))]) if times else None
    return {"requests_1h": sum(statuses.values()), "routes_1h": len(times), "p50_ms": pick(.5), "p95_ms": pick(.95),
            "errors_1h": sum(n for code, n in statuses.items() if code >= "400"), "busy_1h": statuses.get("429", 0) + statuses.get("503", 0),
            "status_5xx_1h": sum(n for code, n in statuses.items() if code.startswith("5")), "status": statuses}


def backup():
    props = dict(line.split("=", 1) for line in run("systemctl", "show", "sonnenpfad-backup.service", "-p", "Result", "-p", "ExecMainExitTimestamp").splitlines() if "=" in line)
    stamp = props.get("ExecMainExitTimestamp", "")
    when = None
    if stamp:
        try:
            when = datetime.strptime(" ".join(stamp.split()[1:3]), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            when = None
    return {"last_result": props.get("Result") or None, "last_time": when}


def main():
    os.makedirs(STATE, exist_ok=True)
    state_file = os.path.join(STATE, "net-state.json")
    try:
        previous = json.load(open(state_file))
    except Exception:
        previous = None
    now = time.time()
    net, net_state = network(previous)
    json.dump(net_state, open(state_file, "w"))
    with open("/proc/uptime") as f:
        uptime = float(f.read().split()[0])
    metrics = {
        "time": datetime.now(timezone.utc).isoformat(), "host": os.uname().nodename, "uptime_s": round(uptime),
        "load": [round(v, 2) for v in os.getloadavg()], "cpu_pct": cpu_percent(), "mem": memory(), "disk": disk(), "net": net,
        "services": {name: run("systemctl", "is-active", name) or "unknown" for name in SERVICES},
        "db": database(), "api": api(now), "backup": backup(),
    }
    history_file = os.path.join(STATE, "history.jsonl")
    entry = {"t": metrics["time"], "cpu": metrics["cpu_pct"], "mem": metrics["mem"]["pct"], "load": metrics["load"][0], "req": metrics["api"]["requests_1h"]}
    lines = []
    try:
        lines = open(history_file).read().splitlines()
    except FileNotFoundError:
        pass
    lines = (lines + [json.dumps(entry)])[-HISTORY_DAYS * 288:]
    open(history_file, "w").write("\n".join(lines) + "\n")
    # Dashboard history: hourly means of the last 7 days.
    hourly = {}
    for line in lines:
        item = json.loads(line); hour = item["t"][:13]
        bucket = hourly.setdefault(hour, {"t": hour + ":00:00Z", "cpu": 0, "mem": 0, "req": 0, "n": 0})
        bucket["cpu"] += item["cpu"]; bucket["mem"] += item["mem"]; bucket["req"] = max(bucket["req"], item["req"]); bucket["n"] += 1
    metrics["history"] = [{"t": b["t"], "cpu": round(b["cpu"] / b["n"], 1), "mem": round(b["mem"] / b["n"], 1), "req": b["req"]} for b in hourly.values()]
    temporary = os.path.join(STATE, "latest.json.tmp")
    with open(temporary, "w") as f:
        json.dump(metrics, f, separators=(",", ":"))
    os.chmod(temporary, 0o644)
    os.replace(temporary, os.path.join(STATE, "latest.json"))


if __name__ == "__main__":
    main()
