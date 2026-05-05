#!/usr/bin/env python3
"""Grader для тестов: возвращает первое число из submission файла."""
import sys
with open(sys.argv[1]) as f:
    line = f.readline().strip()
print(line)
