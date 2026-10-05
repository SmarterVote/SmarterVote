def test_race_json_blanks_placeholder_metadata_strings():
    from shared.models import RaceJSON

    race = RaceJSON.model_validate(
        {
            "id": "ma-governor-2026",
            "election_date": "2026-11-03",
            "candidates": [],
            "updated_utc": "2026-10-01T00:00:00Z",
            "office": "Governor of Massachusetts",
            "district": "null",
            "jurisdiction": " None ",
        }
    )
    assert race.district is None
    assert race.jurisdiction is None
    assert race.office == "Governor of Massachusetts"
