import importlib.util
from pathlib import Path
import unittest
import tempfile
import subprocess
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cors', Path(__file__).parents[1] / 'scripts/repair_custom_domain_cors.py')
cors = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cors)


class CorsRepairTests(unittest.TestCase):
    def test_explicit_map_preserves_other_origins(self):
        source = 'map $http_origin $cors_origin {\n default "";\n "' + cors.OLD + '" $http_origin;\n "http://localhost:8080" $http_origin;\n}\n'
        result = cors.updated_map(source)
        self.assertIn('"' + cors.NEW + '" $http_origin;', result)
        self.assertEqual(result.replace('\n "' + cors.NEW + '" $http_origin;', ''), source)

    def test_literal_value_uses_new_origin(self):
        source = 'map $http_origin $origin {\n "' + cors.OLD + '" "' + cors.OLD + '";\n}\n'
        self.assertIn('"' + cors.NEW + '" "' + cors.NEW + '";', cors.updated_map(source))

    def test_regex_and_unrelated_map_are_not_rewritten(self):
        for source in ['map $host $origin {\n "' + cors.OLD + '" $http_origin;\n}\n',
                       'map $http_origin $origin {\n ~^https://example.com $http_origin;\n}\n']:
            self.assertIsNone(cors.updated_map(source))

    def test_ambiguous_maps_are_rejected(self):
        source = 'map $http_origin $origin {\n "' + cors.OLD + '" $http_origin;\n}\n'
        with self.assertRaises(ValueError):
            cors.updated_map(source + source)

    def test_existing_custom_origin_requires_verification(self):
        source = 'map $http_origin $origin {\n "' + cors.OLD + '" $http_origin;\n "' + cors.NEW + '" $http_origin;\n}\n'
        with self.assertRaises(ValueError):
            cors.updated_map(source)

    def test_crlf_preserved(self):
        source = 'map $http_origin $origin {\r\n "' + cors.OLD + '" $http_origin;\r\n}\r\n'
        result = cors.updated_map(source)
        self.assertNotIn('\r\r', result)
        self.assertEqual(result.count('\n'), result.count('\r\n'))

    def test_validation_failure_restores_bytes_before_reload(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'cors.conf'
            path.write_bytes(b'original')
            failed = subprocess.CalledProcessError(1, ['nginx', '-t'])
            with patch.object(cors.subprocess, 'run', side_effect=[failed, None, None]) as run:
                with self.assertRaises(subprocess.CalledProcessError):
                    cors.apply_configuration(path, b'original', b'changed', path.stat(), 'nginx')
            self.assertEqual(path.read_bytes(), b'original')
            self.assertEqual(run.call_args_list[-1].args[0], ['systemctl', 'reload', 'nginx'])

    def test_failed_live_check_restores_bytes_and_reloads(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'cors.conf'
            path.write_bytes(b'original')
            with patch.object(cors.subprocess, 'run') as run, patch.object(cors, 'probe', return_value=(False, {})):
                with self.assertRaises(ValueError):
                    cors.apply_configuration(path, b'original', b'changed', path.stat(), 'nginx')
            self.assertEqual(path.read_bytes(), b'original')
            self.assertEqual(run.call_count, 4)


if __name__ == '__main__':
    unittest.main()
