# Agent Notes

## Node setup

This repo uses `fnm` to manage Node. If `node` is not on PATH, run `eval "$(fnm env)" && fnm use 24` before any `npm` commands.

## dev server

Assume there's a dev server available on http://localhost:5173/ which is showing the user changes, live.


## Before committing

Always run these two commands before committing code changes:

```bash
npm run lint
npm run format
```

Do not commit if `lint` fails. Fix the errors first.
