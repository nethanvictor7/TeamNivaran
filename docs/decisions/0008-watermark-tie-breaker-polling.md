# ADR 0008: Watermark and tie-breaker polling

PostgreSQL adapters accept validated identifiers only, bind checkpoint values,
and order by `(watermark, tie-breaker)`. Raw rows and the advanced checkpoint
commit together under a database-backed lease.
