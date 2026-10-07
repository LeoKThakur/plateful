"""Build public/data/fndds.json, the offline generic-food database, from USDA FNDDS 2021-2023.

Usage: python3 tools/build_fndds.py path/to/surveyDownload.json
Source: https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip
"""
import json, sys

# app nutrient key -> USDA nutrient id. Values are stored per 100 g.
NUTRIENTS = {
    "kcal": 1008, "p": 1003, "c": 1005, "f": 1004, "fib": 1079, "sug": 2000,
    "sat": 1258, "na": 1093, "chol": 1253, "k": 1092, "ca": 1087, "fe": 1089,
    "vitc": 1162, "vitd": 1114, "caf": 1057,
}
KEYS = list(NUTRIENTS)

src = json.load(open(sys.argv[1]))["SurveyFoods"]
out = []
for food in src:
    by_id = {n["nutrient"]["id"]: n.get("amount", 0) or 0 for n in food["foodNutrients"]}
    values = [round(by_id.get(NUTRIENTS[k], 0), 2) for k in KEYS]
    portions = []
    for p in sorted(food.get("foodPortions", []), key=lambda p: p.get("sequenceNumber", 0)):
        desc, grams = p.get("portionDescription", "").strip(), p.get("gramWeight")
        if desc and grams and "Quantity not specified" not in desc:
            portions.append([desc, round(grams, 1)])
    out.append({
        "id": f"usda-{food['fdcId']}",
        "n": food["description"],
        "cat": food.get("wweiaFoodCategory", {}).get("wweiaFoodCategoryDescription", ""),
        "v": values,
        "pt": portions[:8],
    })

json.dump({"keys": KEYS, "source": "USDA FNDDS 2021-2023", "foods": out},
          open("public/data/fndds.json", "w"), separators=(",", ":"))
print(len(out), "foods")
