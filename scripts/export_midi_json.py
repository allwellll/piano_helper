from __future__ import annotations

import json
import sys
from pathlib import Path

from parse_midi import parse_midi


def export_midi(source_path: Path, output_path: Path) -> None:
    parsed = parse_midi(source_path)
    ticks_per_beat = parsed["ticksPerBeat"]
    bpm = parsed["bpm"]

    track = parsed["tracks"][0]
    notes = []
    for index, note in enumerate(track["notes"]):
        hand = "right" if note["channel"] == 0 else "left"
        notes.append(
            {
                "id": f"note-{index}",
                "midi": note["midi"],
                "start": round(note["startTick"] / ticks_per_beat, 6),
                "duration": round(note["durationTick"] / ticks_per_beat, 6),
                "end": round((note["startTick"] + note["durationTick"]) / ticks_per_beat, 6),
                "velocity": note["velocity"],
                "hand": hand,
                "interactive": hand == "right",
                "label": f"{note['midi']}",
            }
        )

    song = {
        "title": "富士山下 / Under Mount Fuji",
        "subtitle": "Imported from MIDI",
        "sourceFile": str(source_path),
        "bpm": bpm,
        "ticksPerBeat": ticks_per_beat,
        "durationSeconds": parsed["durationSeconds"],
        "minMidi": parsed["minMidi"],
        "maxMidi": parsed["maxMidi"],
        "rightHandCount": sum(1 for note in notes if note["hand"] == "right"),
        "leftHandCount": sum(1 for note in notes if note["hand"] == "left"),
        "noteCount": len(notes),
        "notes": notes,
    }

    output_path.write_text(json.dumps(song, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: export_midi_json.py <source.mid> <output.json>")

    export_midi(Path(sys.argv[1]), Path(sys.argv[2]))


if __name__ == "__main__":
    main()
