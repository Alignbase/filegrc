# Measuring calculation growth

Run the scaling benchmark from the source repository with Node 24:

```sh
npm run benchmark:scaling -- --output=/tmp/filegrc-scaling.json
```

The defaults cover 1,000, 10,000, and 50,000 records, relationship densities of one and four, and zero or ten prior snapshots. Each case runs in a separate process. It selects 64 evenly spaced Controls and calculates both current and legacy applicability revisions. Programs contain at most 64 services, so the benchmark can distinguish workspace growth from growth in an individual Program's scope.

The output records wall time and CPU time for a cold calculation snapshot, repeat calculations in the same snapshot, a one-record edit with a fresh cache, and independent historical snapshots. A separate membership measurement places the sampled Controls in one large Program to expose repeated scope selection. It also records peak process memory, final heap use, raw record payload size, structured-clone cost, and a digest of calculated revisions and membership results. Compare digests before comparing performance: every case should produce the same result across an optimization.

Customize the workload without changing source files:

```sh
npm run benchmark:scaling -- --sizes=1000,10000,50000 --density=1,8 --history=0,20 --samples=128
```

Use `--source=/absolute/path/to/filegrc/package` to measure another source checkout containing the same calculation-cache interface. Run baseline and candidate sequentially on the same idle machine and repeat measurements before setting a performance budget.

These are generic calculation inputs, not validated operating records. Historical arrays represent immutable prior snapshots; their timings exclude Git history discovery, file parsing, and subprocess costs. Raw record payload and cloning measurements exclude the model, entries, and HTTP envelopes. This benchmark does not establish whole-page latency or concurrent-user capacity. Those require a separately validated workspace, an owned local server, and browser measurements.

The server registers each verified workspace snapshot with its calculation worker once. Subsequent section requests send its ID. Both sides retain at most two registered snapshots and re-register an evicted snapshot when needed. A stopped or replaced worker clears the registration state. Snapshot verification and write invalidation still happen on the HTTP server.

Snapshot-scoped resource indexes share ID, type, and relationship lookups across applicability, reviewer selection, Obligations, and workflow calculations. Program membership shares selected Control, System, and Policy sets and source relationship traversals. Schedule review calculates reviewer conflicts once and indexes rules by Obligation. Indexes preserve input order and duplicate rows, and the ID map retains the existing last-record behavior. Ordinary domain calls rebuild indexes to observe mutable inputs. These indexes do not reuse results across changed snapshots.

Remaining scaling boundaries include full-workspace bootstrap payloads, complete validation after snapshot changes, broad Program scope projections, and one calculation worker per server. Measure these separately before adding pagination, dependency-based invalidation, or additional workers.
