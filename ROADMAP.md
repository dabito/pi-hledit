# Roadmap

## Agent search and anchor safety backlog

- [ ] Expose grep context windows in the Pi tool; default to a small balanced context (`2`) when `grep` is used, and allow `context:0` for match-only output.
- [ ] Track core `hledit find` support and expose anchored repo-wide search once available.
- [ ] Track core `peek`/read-around-anchor support so agents can expand context from a known `LN#HASH` without manual offset math.
- [ ] Expose future match controls (`ignoreCase`, `word`, `maxMatches`, explicit regex mode) after core support lands.
- [ ] Surface future variable/adaptive hash config in `/hledit-status` when core `hledit` supports it.
