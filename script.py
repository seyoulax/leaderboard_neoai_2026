import pandas as pd
from transliterate import translit
import json
from pathlib import Path
df = pd.read_excel("./participants.xlsx")
df['Комментарий'].fillna('', inplace=True)
rows = []
for i, row in df.iterrows():
    rows.append(
        {
            "id": translit(
                '-'.join(row["ФИО"].split(" ")[:2]).lower(), language_code="ru", reversed=True
            ),
            "name": row["ФИО"],
            "kaggleId": "mhrzmmhrzm",
            "photo": "/photos/anna-smirnova.jpg",
            "role": "Участник",
            "city": row["Город"],
            "grade": row["Класс"],
            "achievements": row["Достижения"].split("\n"),
            "bio": row["Комментарий"][:100],
        }
    )
path = Path(
    "/Users/seyolax/projects/neoai-transa/new_lb/backend/data/participants.json"
)
path.write_text(json.dumps(rows, indent=4, ensure_ascii=False), encoding="utf-8")