"""
Step 5 prerequisite - full terminal loop, no UI yet.

Wires all four pieces together end to end, entirely by voice:

    stt.py  -->  nlu.py  -->  action_protocol.py  -->  tts.py
  (listen)     (understand)      (act, mock bank)      (speak back)

Confirmation is voice-driven too, not typed: for any action with
requires_confirmation, the prompt is spoken via tts.speak() and the answer
is listened for via stt.py, then parsed for yes/no. This isn't a demo
shortcut - it's the actual point of the app. The target users are blind and
elderly people who need to operate their bank account without reading a
screen or typing, so if confirmation required typing, the app wouldn't
serve them at all.

Run: python main.py
Say a banking request, listen to the response, repeat. Say "quit" or
"exit" (or خروج / توقف) to stop, or Ctrl+C.
"""

import sys
import re

import stt
import tts
from nlu import extract_intent
from action_protocol import MockBankBackend, process_intent, build_confirmation_message, AFFIRMATIVE, NEGATIVE

QUIT_WORDS = {"quit", "exit", "خروج", "توقف", "وقف"}
MAX_CONFIRM_ATTEMPTS = 3


def _words(text: str) -> set:
    return set(re.findall(r"[\w؀-ۿ]+", text.lower()))


def _is_quit(transcript: str) -> bool:
    return bool(_words(transcript) & QUIT_WORDS)


def _parse_yes_no(transcript: str):
    """Returns True/False if a yes/no word is found anywhere in the spoken
    answer, or None if neither is present (real speech often isn't a bare
    'yes'/'no' - e.g. "نعم اكيد" or "yes go ahead")."""
    words = _words(transcript)
    if words & AFFIRMATIVE:
        return True
    if words & NEGATIVE:
        return False
    return None


def voice_confirm(intent: dict) -> bool:
    lang = intent.get("response_language", "ar")
    dialect = intent.get("dialect")
    prompt = build_confirmation_message(intent)

    for attempt in range(MAX_CONFIRM_ATTEMPTS):
        tts.speak(prompt, lang, dialect)
        audio = stt.record_until_silence()
        answer = stt.transcribe(audio)
        print(f"[confirmation heard] {answer['text']}")

        decision = _parse_yes_no(answer["text"])
        if decision is not None:
            return decision

        prompt = "لم أفهم، من فضلك قل نعم أو لا." if lang == "ar" else "Sorry, please say yes or no."

    # Ran out of attempts - fail safe by treating as declined, never as confirmed.
    return False


def main():
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")

    backend = MockBankBackend()

    print("Voice banking - full loop. Speak a request, or say 'quit'/'خروج' to stop.")

    while True:
        try:
            audio = stt.record_until_silence()
            heard = stt.transcribe(audio)
        except KeyboardInterrupt:
            break

        transcript = heard["text"]
        language = heard["language"]

        if not transcript:
            continue
        if _is_quit(transcript):
            break

        print(f"[you said] {transcript}")

        intent = extract_intent(transcript, language=language, account_context=backend.to_account_context())
        print(f"[intent] action={intent['action']} confidence={intent.get('confidence')} requires_confirmation={intent.get('requires_confirmation')}")

        response = process_intent(intent, backend, confirm_fn=voice_confirm)
        tts.speak(response["message"], intent.get("response_language", language), intent.get("dialect"))

    print("Session ended.")


if __name__ == "__main__":
    main()
