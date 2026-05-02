import json
import pandas as pd
from pathlib import Path

path = Path("backend/data/participants.json")
participants = json.loads(path.read_text(encoding='utf-8'))
print('BEFORE', len(participants))
mapping = pd.read_csv("kaggle_acc_map.csv")
for par in participants:
    for i, row in mapping.iterrows():
        if row['full_name'] == par['name']:
            par['kaggleId'] = row["kaggle_username"]
print("AFTER", len(participants))
path.write_text(json.dumps(participants, indent=4, ensure_ascii=False), encoding="utf-8")