#!/usr/bin/env python3
import argparse
from caesar import encode, decode

def main():
    parser = argparse.ArgumentParser(description="Caesar cipher tool")
    parser.add_argument("mode", choices=["encode", "decode"])
    parser.add_argument("text", help="Text to process")
    parser.add_argument("shift", type=int, help="Shift value (0-25)")
    args = parser.parse_args()

    if args.mode == "encode":
        print(encode(args.text, args.shift))
    else:
        print(decode(args.text, args.shift))

if __name__ == "__main__":
    main()
