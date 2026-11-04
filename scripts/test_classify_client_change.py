import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("classifier", Path(__file__).with_name("classify-client-change.py"))
classifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(classifier)


class ClassificationTests(unittest.TestCase):
    def version_diff(self, before, after):
        with patch.object(classifier, "git", side_effect=[before, after]):
            return classifier.is_version_only("base", "head", ["desktop/package.json"])

    def test_only_version_value_changes(self):
        self.assertTrue(self.version_diff('{"version":"1.0.0","dependencies":{"a":"1"}}',
                                          '{"version":"1.0.1","dependencies":{"a":"1"}}'))

    def test_dependency_change_and_deletion_are_not_version_only(self):
        for after in ['{"version":"1.0.1","dependencies":{"a":"2"}}', '{"version":"1.0.1"}']:
            self.assertFalse(self.version_diff('{"version":"1.0.0","dependencies":{"a":"1"}}', after))

    def test_gradle_only_normalizes_version_assignments(self):
        before = 'versionCode = 9\nversionName = "0.3.2"\nminSdk = 24\n'
        after = 'versionCode = 10\nversionName = "0.3.3"\nminSdk = 24\n'
        self.assertEqual(classifier.version_fields("android/app/build.gradle.kts", before)[0],
                         classifier.version_fields("android/app/build.gradle.kts", after)[0])
        self.assertNotEqual(classifier.version_fields("android/app/build.gradle.kts", before)[0],
                            classifier.version_fields("android/app/build.gradle.kts", after.replace("24", "25"))[0])

    def test_mixed_changes_keep_all_affected_tiers(self):
        result = classifier.classify(["desktop/src/pet/controller.ts", "android/app/src/main/Main.kt"], False, False)
        self.assertTrue(result["windows"])
        self.assertTrue(result["android"])
        self.assertEqual(len(result["windows_matrix"]), 1)

    def test_unknown_paths_are_conservative(self):
        result = classifier.classify(["new-runtime-config.json"], False, False)
        self.assertTrue(result["windows"])
        self.assertTrue(result["updater"])

    def test_full_and_version_only(self):
        full = classifier.classify([], False, True)
        self.assertEqual(len(full["windows_matrix"]), 4)
        self.assertTrue(full["unit"] and full["updater"] and full["pet_media"])
        fast = classifier.classify(["desktop/package.json"], True, False)
        self.assertFalse(fast["windows"] or fast["updater"] or fast["android"])
        self.assertEqual(classifier.classify(["docs/help.md"], False, False)["tier"], "docs")


if __name__ == "__main__":
    unittest.main()
