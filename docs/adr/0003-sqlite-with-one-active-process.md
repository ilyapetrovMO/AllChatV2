# Use SQLite with one active process

Each Instance will have exactly one active AllChat process owning its SQLite database; shared-database clustering and horizontal scaling are unsupported. SQLite's self-contained operation, transactional persistence, online backup support, and simple administration fit community self-hosting better than an external database, while vertical scaling and the documented first-release capacity targets bound the trade-off.
