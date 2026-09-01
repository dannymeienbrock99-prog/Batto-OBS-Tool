# CNG Personal Chat Configuration

Batto treats a creator's CNG OBS chat access like a personal stream credential: the creator pastes the complete CNG chat URL supplied for their account.

## Chat

Example shape:

`https://cng-plattform.com/chat-popout/{creatorId}?mode=obs&obsChatToken=...`

The complete URL is accepted. Batto extracts the creator ID, mode and OBS chat token internally.

## Alerts

Example shape:

`https://cng-plattform.com/alert-overlay?creatorId={creatorId}&alertTts=1&chatTts=0`

The URL is kept as the creator's personal alert configuration. TTS flags are read from the URL and can later be exposed in the Batto UI.

## Security

- Personal CNG URLs/tokens are user secrets.
- Do not commit real CNG URLs or tokens to GitHub.
- Do not print the token in logs or diagnostics.
- Store the secret through Batto's local encrypted `SecretStore` when the desktop UI is wired to the model.

## Transport boundary

`cng-adapter.cjs` deliberately does not assume a public CNG realtime protocol. The adapter accepts a transport factory so the actual chat/event transport can be implemented and tested independently once the CNG endpoint behavior is verified.
