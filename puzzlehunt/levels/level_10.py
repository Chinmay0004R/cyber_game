from levels.level_02 import LEVEL as L2
from levels.level_03 import LEVEL as L3
from levels.level_04 import LEVEL as L4
from levels.level_05 import LEVEL as L5
from levels.level_06 import LEVEL as L6
from levels.level_07 import LEVEL as L7
from levels.level_08 import LEVEL as L8
from levels.level_09 import LEVEL as L9

_CHAIN = [L2, L3, L4, L5, L6, L7, L8, L9]

LEVEL = {
    "id": 10,
    "title": "The Master Key",
    "clue_text": (
        "Final Gate: Combine the FIRST letter of each answer from Levels 2 through 9 "
        "in order (8 letters, no spaces)."
    ),
    "answer": "".join(lvl["answer"][0] for lvl in _CHAIN),
    "hint": "Look back at your solved words for Levels 2, 3, 4, 5, 6, 7, 8, and 9 and take their initials.",
}

