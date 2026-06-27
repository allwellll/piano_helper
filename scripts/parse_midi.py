from __future__ import annotations

import json
import math
import struct
import sys
from pathlib import Path


def read_vlq(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    while True:
        byte = data[offset]
        offset += 1
        value = (value << 7) | (byte & 0x7F)
        if not (byte & 0x80):
            break
    return value, offset


def parse_midi(path: Path) -> dict:
    data = path.read_bytes()
    offset = 0

    if data[offset:offset + 4] != b"MThd":
        raise ValueError("Not a MIDI file")
    offset += 4

    header_length = struct.unpack(">I", data[offset:offset + 4])[0]
    offset += 4
    fmt, track_count, division = struct.unpack(">HHH", data[offset:offset + 6])
    offset += header_length

    tempo = 500000
    tempo_events = []
    tracks = []
    global_note_min = 127
    global_note_max = 0
    max_tick = 0

    for track_index in range(track_count):
      if data[offset:offset + 4] != b"MTrk":
          raise ValueError("Invalid track chunk")
      offset += 4
      chunk_length = struct.unpack(">I", data[offset:offset + 4])[0]
      offset += 4
      track_end = offset + chunk_length

      abs_tick = 0
      running_status = None
      notes_on = {}
      track_name = f"Track {track_index + 1}"
      instrument = None
      notes = []

      while offset < track_end:
          delta, offset = read_vlq(data, offset)
          abs_tick += delta
          max_tick = max(max_tick, abs_tick)

          status = data[offset]
          if status < 0x80:
              if running_status is None:
                  raise ValueError("Running status without previous status")
              status = running_status
          else:
              offset += 1
              running_status = status

          if status == 0xFF:
              meta_type = data[offset]
              offset += 1
              length, offset = read_vlq(data, offset)
              payload = data[offset:offset + length]
              offset += length

              if meta_type == 0x03 and payload:
                  track_name = payload.decode("latin1", errors="replace")
              elif meta_type == 0x51 and len(payload) == 3:
                  current_tempo = int.from_bytes(payload, "big")
                  tempo_events.append({"tick": abs_tick, "tempoMicroseconds": current_tempo})
                  if tempo == 500000:
                      tempo = current_tempo
              continue

          if status in (0xF0, 0xF7):
              length, offset = read_vlq(data, offset)
              offset += length
              continue

          event_type = status >> 4
          channel = status & 0x0F

          if event_type in (0x8, 0x9):
              note = data[offset]
              velocity = data[offset + 1]
              offset += 2

              key = (channel, note)
              if event_type == 0x9 and velocity > 0:
                  notes_on.setdefault(key, []).append((abs_tick, velocity))
                  global_note_min = min(global_note_min, note)
                  global_note_max = max(global_note_max, note)
              else:
                  if key in notes_on and notes_on[key]:
                      start_tick, start_velocity = notes_on[key].pop(0)
                      notes.append(
                          {
                              "midi": note,
                              "startTick": start_tick,
                              "durationTick": max(1, abs_tick - start_tick),
                              "velocity": start_velocity,
                              "channel": channel,
                          }
                      )
              continue

          if event_type == 0xA:
              offset += 2
          elif event_type == 0xB:
              offset += 2
          elif event_type == 0xC:
              instrument = data[offset]
              offset += 1
          elif event_type == 0xD:
              offset += 1
          elif event_type == 0xE:
              offset += 2
          else:
              raise ValueError(f"Unsupported event type: {event_type}")

      tracks.append(
          {
              "index": track_index,
              "name": track_name,
              "instrument": instrument,
              "noteCount": len(notes),
              "notes": sorted(notes, key=lambda item: (item["startTick"], item["midi"])),
          }
      )

    seconds_per_tick = (tempo / 1_000_000) / division
    duration_seconds = max_tick * seconds_per_tick

    return {
        "format": fmt,
        "trackCount": track_count,
        "ticksPerBeat": division,
        "tempoMicroseconds": tempo,
        "tempoEvents": tempo_events,
        "bpm": round(60_000_000 / tempo, 2),
        "durationSeconds": round(duration_seconds, 3),
        "minMidi": global_note_min if global_note_min != 127 else None,
        "maxMidi": global_note_max if global_note_max != 0 else None,
        "tracks": tracks,
    }


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: parse_midi.py <path-to-midi>")

    path = Path(sys.argv[1])
    parsed = parse_midi(path)
    print(json.dumps(parsed, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
