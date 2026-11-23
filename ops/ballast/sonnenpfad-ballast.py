#!/usr/bin/env python3
"""Hold a fixed amount of memory so the Always Free VM stays above Oracle's idle threshold.

Oracle may reclaim an A1 instance when CPU, network and memory all stay below 20 % for 7 days.
This process writes every page of an anonymous mapping once (untouched pages would not count
as used memory) and then sleeps. It uses no CPU, no network and no files. systemd gives it the
highest OOM score, so under memory pressure the kernel kills it before any real service.
"""
import mmap
import os
import signal
import sys

PAGE = mmap.PAGESIZE


def fill(megabytes):
    size = megabytes * 1024 * 1024
    block = mmap.mmap(-1, size)
    for offset in range(0, size, PAGE):
        block[offset] = 1  # one byte per page makes the page resident
    return block


def resident_mb():
    try:
        with open('/proc/self/status') as status:
            return next(int(line.split()[1]) // 1024 for line in status if line.startswith('VmRSS:'))
    except (OSError, StopIteration):
        return None


def main():
    megabytes = int(os.environ.get('BALLAST_MB', '1800'))
    if not 64 <= megabytes <= 4096:
        sys.exit(f'BALLAST_MB must be between 64 and 4096, got {megabytes}')
    block = fill(megabytes)
    resident = resident_mb()
    # Self-check: the memory must really be resident, otherwise Oracle would not count it.
    if resident is not None and resident < megabytes * 0.95:
        sys.exit(f'only {resident} MB resident of {megabytes} MB')
    print(f'holding {megabytes} MB (resident {resident} MB)', flush=True)
    if len(sys.argv) > 1 and sys.argv[1] == '--check':
        return
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    while True:  # `block` stays referenced until the process ends
        signal.pause()


if __name__ == '__main__':
    main()
