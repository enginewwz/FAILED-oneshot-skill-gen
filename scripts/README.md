# scripts

- `dsh-skillgen.sh` — foreground launcher for the isolated dev instance.
  Sets `DSH_HOME=.dsh`, injects `DEEPSEEK_API_KEY` from `~/.deepseek_env`, and
  applies `.dsh/skill-gen/dev.patch.yml` when present.
- `seed-session.sh` — copies one session (and its workspace record) from the
  main dsh home into the isolated home. Pass a session id, or omit it to copy
  the newest session of this project.
- `check-model.sh` — prints whether the API key/proxy are present and checks
  `https://api.deepseek.com/v1/models`; never prints the key.

No daemon, tmux, or shell rc changes.
