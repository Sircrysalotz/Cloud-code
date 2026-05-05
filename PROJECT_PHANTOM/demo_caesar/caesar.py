def encode(text: str, shift: int) -> str:
    shift = shift % 26
    result = []
    for ch in text:
        if ch.isalpha():
            base = ord('A') if ch.isupper() else ord('a')
            result.append(chr((ord(ch) - base + shift) % 26 + base))
        else:
            result.append(ch)
    return ''.join(result)


def decode(text: str, shift: int) -> str:
    return encode(text, -shift)
