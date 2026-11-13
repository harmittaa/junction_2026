"""Deterministic checks for the Orb credential boundary; no cloud calls."""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

AGENTS = Path(__file__).resolve().parent


class CloudSetupTest(unittest.TestCase):
    def test_token_helper_success_and_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            fake_amp = Path(directory) / "amp"
            payload = base64.urlsafe_b64encode(json.dumps({"exp": 2000000000}).encode()).decode().rstrip("=")
            token = f"header.{payload}.signature"
            fake_amp.write_text(f"#!/bin/sh\nprintf '%s' '{token}'\n")
            fake_amp.chmod(0o700)
            env = {**os.environ, "PATH": directory + os.pathsep + os.environ["PATH"]}
            result = subprocess.run([str(AGENTS / "gcp-token")], env=env, capture_output=True, text=True, check=True)
            data = json.loads(result.stdout)
            self.assertEqual(data["id_token"], token)
            self.assertEqual(data["expiration_time"], 2000000000)
            self.assertEqual(result.stderr, "")

            fake_amp.write_text("#!/bin/sh\necho private-error-detail >&2\nexit 1\n")
            result = subprocess.run([str(AGENTS / "gcp-token")], env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(json.loads(result.stdout)["success"])
            self.assertNotIn("private-error-detail", result.stdout + result.stderr)

    def test_resume_config_targets_only_sponky_and_is_repeatable(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "credentials" / "google-adc.json"
            env = {**os.environ, "GOOGLE_APPLICATION_CREDENTIALS": str(destination)}
            for _ in range(2):
                subprocess.run([str(AGENTS / "resume")], env=env, capture_output=True, check=True)
            data = json.loads(destination.read_text())
            self.assertEqual(data["quota_project_id"], "sponky-junction-2026")
            self.assertIn("amp-sponky@sponky-junction-2026.iam.gserviceaccount.com", data["service_account_impersonation_url"])
            self.assertEqual(data["credential_source"]["executable"]["command"], str(AGENTS / "gcp-token"))
            self.assertNotIn("private_key", data)
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
