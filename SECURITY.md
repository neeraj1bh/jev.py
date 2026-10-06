# Security

Report a vulnerability privately through the repository's **Security** tab
("Report a vulnerability"), not in a public issue.

What jev.py touches, so you know what is in scope:

- Its servers bind 127.0.0.1 unless you set `JEV_HOST`. Even then, setting keys, adding, deleting or
  downloading models and changing model folders answer requests from this machine only, and the
  page refuses requests sent by other sites.
- API keys live in your `.env`, which git ignores, and go only to the provider each one is for.
- Without a key it reaches only public data: models and datasets from Hugging Face, TypeSafe's
  published test cases, and OpenRouter's and Vercel's model lists and prices. No telemetry:
  nothing about you, your keys or your runs is sent anywhere else.
- Saved runs, downloaded models and datasets stay in git-ignored folders on your machine.
