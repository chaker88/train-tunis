import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_data  # noqa: E402

WINTER = "winter_2026_2027"
EXPECTED_COUNTS = {
    "A": {"to_tunis": 59, "from_tunis": 60},
    "D": {"to_tunis": 37, "from_tunis": 36},
    "E": {"to_tunis": 60, "from_tunis": 60},
}
E_HEADER = "Direction,Jours_Circulation,N_Train,Bougatfa,Al Hrairiya,Ezzouhour,Ettayarane,Ennajah,Saida Manoubia,Tunis"
E_ROW = "Bougatfa_to_Tunis,-,1,05:00,05:02,05:04,05:07,05:09,05:11,05:15"


class RealDataTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.tmp.name)
        cls.summary = build_data.build(out_dir=cls.out)
        cls.lines = {
            code: json.loads((cls.out / WINTER / f"line_{code}.json").read_text(encoding="utf-8"))
            for code in EXPECTED_COUNTS
        }
        cls.index = json.loads((cls.out / "timetables.json").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_produces_three_files(self):
        self.assertEqual(sorted(p.name for p in (self.out / WINTER).glob("line_*.json")),
                         ["line_A.json", "line_D.json", "line_E.json"])

    def test_index(self):
        winter = next(p for p in self.index if p["id"] == WINTER)
        self.assertEqual(winter["type"], "winter")
        self.assertEqual(winter["priority"], 1)
        self.assertEqual((winter["valid_from"], winter["valid_to"]), ("2026-09-01", "2027-06-30"))
        self.assertEqual(winter["lines"], ["A", "D", "E"])
        self.assertTrue(winter["name"]["ar"] and winter["name"]["en"])

    def test_trip_counts(self):
        for code, data in self.lines.items():
            self.assertEqual(data["period"], WINTER)
            for d, n in EXPECTED_COUNTS[code].items():
                self.assertEqual(sum(t["dir"] == d for t in data["trips"]), n, f"line {code} {d}")

    def test_times_strictly_increase_and_no_zero(self):
        for code, data in self.lines.items():
            last = len(data["stations"]) - 1
            for trip in data["trips"]:
                stops = trip["stops"]
                self.assertGreaterEqual(len(stops), 2)
                times = [t for _, t in stops]
                self.assertEqual(times, sorted(set(times)), f"line {code} train {trip['train']}")
                self.assertTrue(all(isinstance(t, int) and 0 < t < 1440 for t in times))
                idx = [s for s, _ in stops]
                self.assertTrue(all(0 <= s <= last for s in idx))
                self.assertEqual(idx, sorted(idx, reverse=trip["dir"] == "from_tunis"))
            self.assertNotIn("0.0", (self.out / WINTER / f"line_{code}.json").read_text(encoding="utf-8"))

    def test_services_are_named(self):
        allowed = {"daily", "no_sun_hol", "sun_hol_only", "no_sat_sun_hol", "no_sat"}
        for data in self.lines.values():
            self.assertTrue({t["service"] for t in data["trips"]} <= allowed)

    def test_trains_unique_per_line(self):
        for data in self.lines.values():
            trains = [t["train"] for t in data["trips"]]
            self.assertEqual(len(trains), len(set(trains)))

    def test_trips_sorted_by_first_departure(self):
        for data in self.lines.values():
            for d in ("to_tunis", "from_tunis"):
                firsts = [t["stops"][0][1] for t in data["trips"] if t["dir"] == d]
                self.assertEqual(firsts, sorted(firsts))


class FixtureTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.raw = Path(self.tmp.name) / "raw"
        self.out = Path(self.tmp.name) / "out"
        self.raw.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, folder, name, text, encoding="utf-8"):
        d = self.raw / folder
        d.mkdir(exist_ok=True)
        (d / name).write_bytes(text.encode(encoding))

    def build(self):
        return build_data.build(raw_dir=self.raw, out_dir=self.out)

    def line(self, period, code):
        return json.loads((self.out / period / f"line_{code}.json").read_text(encoding="utf-8"))

    def test_auto_discovers_new_period_folder(self):
        shutil.copytree(build_data.RAW_DIR / WINTER, self.raw / WINTER)
        self.write("ramadan_2099", "Bougatfa_Tunis.csv", f"{E_HEADER}\n{E_ROW}\n")
        summary = self.build()
        self.assertIn(("ramadan_2099", "E", 1, 0), summary)
        index = json.loads((self.out / "timetables.json").read_text(encoding="utf-8"))
        ram = next(p for p in index if p["id"] == "ramadan_2099")
        self.assertEqual((ram["type"], ram["priority"], ram["lines"]), ("ramadan", 3, ["E"]))
        self.assertEqual((ram["valid_from"], ram["valid_to"]), (None, None))
        self.assertEqual(ram["hijri_year"], 1523)
        self.assertEqual(sorted(p.name for p in (self.out / "ramadan_2099").iterdir()), ["line_E.json"])
        self.assertEqual(len(list((self.out / WINTER).iterdir())), 3)

    def test_summer_folder_dates(self):
        self.write("summer_2027", "Bougatfa_Tunis.csv", f"{E_HEADER}\n{E_ROW}\n")
        self.build()
        index = json.loads((self.out / "timetables.json").read_text(encoding="utf-8"))
        self.assertEqual((index[0]["valid_from"], index[0]["valid_to"], index[0]["priority"]), ("2027-07-01", "2027-08-31", 2))

    def test_bad_folder_name_fails_clearly(self):
        self.write("ramadan2099", "Bougatfa_Tunis.csv", f"{E_HEADER}\n{E_ROW}\n")
        with self.assertRaises(build_data.BuildError) as cm:
            self.build()
        msg = str(cm.exception)
        self.assertIn("ramadan2099", msg)
        self.assertIn("winter_2026_2027", msg)
        self.assertIn("summer_2027", msg)
        self.assertIn("ramadan_2027", msg)

    def test_wrong_winter_years_fail(self):
        self.write("winter_2026_2028", "Bougatfa_Tunis.csv", f"{E_HEADER}\n{E_ROW}\n")
        with self.assertRaisesRegex(build_data.BuildError, "winter_2026_2027"):
            self.build()

    def test_loose_csv_fails(self):
        (self.raw / "Bougatfa_Tunis.csv").write_text(f"{E_HEADER}\n{E_ROW}\n", encoding="utf-8")
        with self.assertRaisesRegex(build_data.BuildError, "inside a timetable folder"):
            self.build()

    def test_underscore_folder_ignored(self):
        self.write("_old", "anything.csv", "garbage")
        self.write("summer_2027", "bougatfa.CSV", f"{E_HEADER}\n{E_ROW}\n")
        self.assertEqual(self.build(), [("summer_2027", "E", 1, 0)])

    def test_lenient_csv(self):
        text = (
            "Direction;Jours_Circulation;N_Train;Bougatfa;Al Hrairiya;Ezzouhour;Ettayarane;Ennajah;Saïda Manoubia;Tunis;;\r\n"
            "Bougatfa_to_Tunis ; – ;402;5:00;5:02;;5:07;0;05:09:00;05:15;;\r\n"
            ";;;;;;;;;;;\r\n"
            "\r\n"
            "Tunis_to_Bougatfa;A;403.0;6:15;06:13;0,0;-;06:06;;06:00\r\n"
            "Tunis_to_Bougatfa;;405;6:45; ;;;;;6:30\r\n"
        )
        self.write(WINTER, "Bougatfa_Tunis.csv", "﻿" + text)
        self.build()
        data = self.line(WINTER, "E")
        trips = {t["train"]: t for t in data["trips"]}
        self.assertEqual(trips[402]["stops"], [[0, 300], [1, 302], [3, 307], [5, 309], [6, 315]])
        self.assertEqual(trips[402]["service"], "daily")
        self.assertEqual(trips[403]["stops"], [[6, 360], [4, 366], [1, 373], [0, 375]])
        self.assertEqual(trips[403]["service"], "no_sun_hol")
        self.assertEqual(trips[405]["stops"], [[6, 390], [0, 405]])
        self.assertEqual(trips[405]["service"], "daily")
        self.assertEqual(data["stations"][5]["id"], "saida-manoubia")

    def test_cp1252_csv(self):
        text = "Direction;Jours_Circulation;N_Train;Bougatfa;Al Hrairiya;Ezzouhour;Ettayarane;Ennajah;Saïda Manoubia;Tunis\r\n" \
               "Bougatfa_to_Tunis;-;1;05:00;05:02;05:04;05:07;05:09;05:11;05:15\r\n"
        self.write(WINTER, "Bougatfa_Tunis.csv", text, encoding="cp1252")
        self.build()
        self.assertEqual(len(self.line(WINTER, "E")["trips"]), 1)

    def test_partial_period_with_subset_of_stations(self):
        self.write("ramadan_2027", "Erriadh_Tunis.csv",
                   "Direction,Jours_Circulation,N_Train,Erriadh,Hammam Lif,Tunis Ville\n"
                   "Erriadh_to_Tunis,-,1,05:00,05:20,05:50\n")
        self.build()
        data = self.line("ramadan_2027", "A")
        self.assertEqual([s["id"] for s in data["stations"]], ["erriadh", "hammam-lif", "tunis"])

    def test_unknown_station_names_file_and_column(self):
        self.write(WINTER, "Bougatfa_Tunis.csv", f"{E_HEADER.replace('Ennajah', 'Nowhere')}\n{E_ROW}\n")
        with self.assertRaises(build_data.BuildError) as cm:
            self.build()
        msg = str(cm.exception)
        self.assertIn(f"{WINTER}/Bougatfa_Tunis.csv", msg)
        self.assertIn("'Nowhere'", msg)
        self.assertIn("column 8", msg)
        self.assertIn("data/stations.json", msg)

    def test_unknown_service_fails(self):
        self.write(WINTER, "Bougatfa_Tunis.csv", f"{E_HEADER}\n{E_ROW.replace(',-,', ',X,')}\n")
        with self.assertRaisesRegex(build_data.BuildError, r"train 1 \(row 2\), column 'Jours_Circulation'"):
            self.build()

    def test_bad_time_names_train_and_column(self):
        self.write(WINTER, "Bougatfa_Tunis.csv", f"{E_HEADER}\n{E_ROW.replace('05:04', '5h04')}\n")
        with self.assertRaisesRegex(build_data.BuildError, r"train 1 \(row 2\), column 'Ezzouhour': invalid time"):
            self.build()

    def test_non_increasing_fails(self):
        self.write(WINTER, "Bougatfa_Tunis.csv", f"{E_HEADER}\n{E_ROW.replace('Bougatfa_to_Tunis', 'Tunis_to_Bougatfa')}\n")
        with self.assertRaisesRegex(build_data.BuildError, "Times must increase"):
            self.build()

    def test_duplicate_train_fails(self):
        self.write(WINTER, "Bougatfa_Tunis.csv", f"{E_HEADER}\n{E_ROW}\n{E_ROW}\n")
        with self.assertRaisesRegex(build_data.BuildError, "already used on row 2"):
            self.build()

    def test_single_stop_fails(self):
        self.write(WINTER, "Bougatfa_Tunis.csv", f"{E_HEADER}\nBougatfa_to_Tunis,-,1,05:00,,,,,,\n")
        with self.assertRaisesRegex(build_data.BuildError, "2 stations or more"):
            self.build()

    def test_unknown_line_file_fails(self):
        self.write(WINTER, "Sousse.csv", f"{E_HEADER}\n{E_ROW}\n")
        with self.assertRaisesRegex(build_data.BuildError, "cannot tell which line"):
            self.build()


if __name__ == "__main__":
    unittest.main()
