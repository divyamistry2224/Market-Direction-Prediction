"""Run with `python -m market_direction.cli fetch|verify|run`."""
import argparse
import json

from .data import fetch, verify


def main():
    parser = argparse.ArgumentParser(description="Market direction research pipeline")
    parser.add_argument("command", choices=["fetch", "verify", "run"])
    args = parser.parse_args()
    if args.command == "fetch": print(json.dumps(fetch(), indent=2))
    elif args.command == "verify": print(json.dumps(verify(), indent=2))
    else:
        from .experiment import run
        run()


if __name__ == "__main__": main()
