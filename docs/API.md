# API Reference (Proposed)

## `POST /rooms`

Create a room.

Request:

```json
{
  "initialState": { "...": "game state" }
}
```

Response:

```json
{
  "roomCode": "ABC123"
}
```

## `GET /rooms/:code`

Return current room state.

Response:

```json
{
  "board": [],
  "currentPlayer": "red",
  "winner": null,
  "moveCount": 0,
  "history": []
}
```

## `POST /rooms/:code/moves`

Apply one move.

Request:

```json
{
  "from": { "row": 6, "col": 0 },
  "to": { "row": 5, "col": 0 }
}
```

Response:

```json
{
  "ok": true
}
```
