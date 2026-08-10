# Keep core operation self-contained in one binary

AllChat will ship as one binary whose core operation requires only the host operating system and one data directory containing SQLite data, attachments, configuration, and TLS material. Optional external infrastructure may enhance an Instance, but must not be required for its core features; this prioritizes straightforward community self-hosting over the independent scaling and operational flexibility of external databases, caches, proxies, or asset services.
