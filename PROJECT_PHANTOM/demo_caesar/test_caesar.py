import pytest
from caesar import encode, decode

def test_encode_basic():
    assert encode("ABC", 3) == "DEF"

def test_encode_wraps():
    assert encode("XYZ", 3) == "ABC"

def test_encode_lowercase():
    assert encode("abc", 3) == "def"

def test_encode_mixed_case():
    assert encode("Hello", 13) == "Uryyb"

def test_encode_preserves_spaces():
    assert encode("Hello World", 3) == "Khoor Zruog"

def test_encode_preserves_punctuation():
    assert encode("Hi, Bob!", 1) == "Ij, Cpc!"

def test_decode_reverses_encode():
    original = "The quick brown fox"
    assert decode(encode(original, 7), 7) == original

def test_decode_basic():
    assert decode("DEF", 3) == "ABC"

def test_shift_zero():
    assert encode("Hello", 0) == "Hello"

def test_shift_26_is_identity():
    assert encode("Hello", 26) == "Hello"

def test_negative_shift():
    assert encode("DEF", -3) == "ABC"
