#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROMPT_MD = ROOT / 'hooks' / 'prompts' / 'task_preflight_checklist.md'
PLUGIN_HOOKS = ROOT / 'plugin' / 'hooks.json'
GENERATED = ROOT / 'plugin' / 'generated' / 'task_preflight_prompt.json'
LIVE_SETTINGS = Path.home() / '.claude' / 'settings.json'


def load_prompt() -> str:
    text = PROMPT_MD.read_text(encoding='utf-8').rstrip() + '\n'
    return text.rstrip('\n')


def prompt_hash(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()[:16]


def update_plugin_hooks(text: str) -> bool:
    doc = json.loads(PLUGIN_HOOKS.read_text())
    changed = False
    for entry in ((doc.get('hooks') or {}).get('PreToolUse') or []):
        if entry.get('matcher') != 'Task':
            continue
        for hook in entry.get('hooks') or []:
            if hook.get('type') == 'prompt':
                if hook.get('prompt') != text:
                    hook['prompt'] = text
                    changed = True
    if changed:
        PLUGIN_HOOKS.write_text(json.dumps(doc, indent=2) + '\n')
    return changed


def verify_live(text: str) -> dict:
    out = {'exists': LIVE_SETTINGS.exists(), 'matches': False, 'hash': None}
    if not LIVE_SETTINGS.exists():
        return out
    try:
        doc = json.loads(LIVE_SETTINGS.read_text())
        for entry in ((doc.get('hooks') or {}).get('PreToolUse') or []):
            for hook in entry.get('hooks') or []:
                if hook.get('type') == 'prompt' and isinstance(hook.get('prompt'), str):
                    h = prompt_hash(hook['prompt'])
                    out['hash'] = h
                    if hook['prompt'].strip() == text.strip():
                        out['matches'] = True
                        return out
    except Exception:
        out['error'] = 'parse_error'
    return out


def apply_live(text: str) -> bool:
    if not LIVE_SETTINGS.exists():
        return False
    doc = json.loads(LIVE_SETTINGS.read_text())
    changed = False
    for entry in ((doc.get('hooks') or {}).get('PreToolUse') or []):
        for hook in entry.get('hooks') or []:
            if hook.get('type') == 'prompt' and hook.get('prompt') != text:
                hook['prompt'] = text
                changed = True
    if changed:
        LIVE_SETTINGS.write_text(json.dumps(doc, indent=2) + '\n')
    return changed


def main() -> int:
    ap = argparse.ArgumentParser(description='Sync prompt markdown into plugin hooks JSON')
    ap.add_argument('--verify-only', action='store_true')
    ap.add_argument('--apply-live', action='store_true')
    args = ap.parse_args()
    text = load_prompt()
    GENERATED.parent.mkdir(parents=True, exist_ok=True)
    GENERATED.write_text(json.dumps({'prompt': text, 'hash': prompt_hash(text)}, indent=2) + '\n')
    changed = False if args.verify_only else update_plugin_hooks(text)
    live_changed = apply_live(text) if args.apply_live else False
    live = verify_live(text)
    print(json.dumps({'prompt_file': str(PROMPT_MD), 'generated': str(GENERATED), 'plugin_hooks_updated': changed, 'live_settings_updated': live_changed, 'prompt_hash': prompt_hash(text), 'live_settings': live}, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
