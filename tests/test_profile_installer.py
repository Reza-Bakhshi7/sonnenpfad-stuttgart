"""Root installer boundary tests: all filesystem paths are isolated in tempdir."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]


class InstallerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        subprocess.run([sys.executable,str(ROOT/'scripts/build_profile_v2_installer.py')],check=True,stdout=subprocess.DEVNULL)

    def setUp(self):
        spec=importlib.util.spec_from_file_location('profile_installer_case',ROOT/'build/install_sonnenpfad_profile_v2.py')
        self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name);self.original=self.base/'api-stage1';self.original.mkdir()
        self.source={name:(ROOT/'services/profile-api-v1'/name).read_bytes() for name in self.module.CORE_HASHES}
        for name,data in self.source.items():(self.original/name).write_bytes(data)
        self.target=self.base/'api-stage2';self.unit=self.base/'unit.service';self.calls=[]
        for key,value in {'BASE':self.base,'ORIGINAL':self.original,'TARGET':self.target,'UNIT':self.unit}.items():
            patcher=patch.object(self.module,key,value);patcher.start();self.addCleanup(patcher.stop)
        for target,value in [(self.module.os,'geteuid'),(self.module.pwd,'getpwnam')]:
            patcher=patch.object(target,value,return_value=0);patcher.start();self.addCleanup(patcher.stop)
        self.run_patch=patch.object(self.module,'run',side_effect=self.fake_run);self.run_patch.start();self.addCleanup(self.run_patch.stop)
        self.subprocess_patch=patch.object(self.module.subprocess,'run',side_effect=lambda args,**kw:self.record(args));self.subprocess_patch.start();self.addCleanup(self.subprocess_patch.stop)
        self.health_patch=patch.object(self.module,'health_ok',return_value=True);self.health_patch.start();self.addCleanup(self.health_patch.stop)
        # Bind checks use an ephemeral local socket, never a real service port.
        self.socket_patch=patch.object(self.module.socket,'socket');sock=self.socket_patch.start();self.addCleanup(self.socket_patch.stop)
        sock.return_value.__enter__.return_value.bind.return_value=None

    def record(self,args):
        self.calls.append(args);return types.SimpleNamespace(returncode=0)

    def fake_run(self,args,**kwargs):return self.record(args)

    def unchanged_original(self):
        for name,data in self.source.items():self.assertEqual((self.original/name).read_bytes(),data)

    def test_install_touches_only_new_service_and_preserves_core(self):
        self.module.install();self.unchanged_original()
        for name,data in self.source.items():self.assertEqual((self.target/name).read_bytes(),data)
        systemd=[args for args in self.calls if args[0]=='systemctl']
        self.assertEqual(systemd,[['systemctl','daemon-reload'],['systemctl','enable','--now','sonnenpfad-profile-v2.service']])
        self.assertTrue(all('sonnenpfad-api.service' not in args for args in self.calls))
        self.assertEqual(self.unit.read_text(),self.module.UNIT_CONTENT)

    def test_changed_source_aborts_before_any_service_action(self):
        (self.original/'profile_api.py').write_text('different version')
        with self.assertRaises(ValueError):self.module.install()
        self.assertEqual(self.calls,[]);self.assertFalse(self.target.exists());self.assertFalse(self.unit.exists())

    def test_existing_different_target_is_not_overwritten(self):
        self.target.mkdir();(self.target/'app.py').write_text('existing user data')
        with self.assertRaises(ValueError):self.module.install()
        self.assertEqual((self.target/'app.py').read_text(),'existing user data');self.assertEqual(self.calls,[])

    def test_existing_different_unit_is_not_overwritten(self):
        self.unit.write_text('another service')
        with self.assertRaises(ValueError):self.module.install()
        self.assertEqual(self.unit.read_text(),'another service');self.assertEqual(self.calls,[])

    def test_failed_acceptance_stops_only_new_service(self):
        def run(args,**kwargs):
            self.record(args)
            if args[-1]=='smoke_v2.py':raise subprocess.CalledProcessError(1,args)
            return types.SimpleNamespace(returncode=0)
        with patch.object(self.module,'run',side_effect=run):
            with self.assertRaises(subprocess.CalledProcessError):self.module.install()
        self.assertIn(['systemctl','disable','--now','sonnenpfad-profile-v2.service'],self.calls)
        self.unchanged_original();self.assertTrue(self.target.exists())

    def test_identical_healthy_install_is_idempotent(self):
        self.module.install();self.calls.clear();self.module.install()
        self.assertEqual(self.calls,[]);self.unchanged_original()


if __name__=='__main__':unittest.main()
