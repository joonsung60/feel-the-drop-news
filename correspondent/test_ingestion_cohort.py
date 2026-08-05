import unittest

from crawler import correspondent_ingestion_source


class IngestionCohortTest(unittest.TestCase):
    def test_correspondent_source_key_is_stable(self) -> None:
        self.assertEqual(
            correspondent_ingestion_source("HTTPS://EXAMPLE.COM/NEWS/"),
            correspondent_ingestion_source("https://example.com/news"),
        )
        self.assertTrue(
            correspondent_ingestion_source("https://example.com/news").startswith(
                "correspondent:"
            )
        )


if __name__ == "__main__":
    unittest.main()
