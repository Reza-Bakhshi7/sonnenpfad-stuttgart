"""Stage-2 updater boundary tests: all filesystem paths are isolated in tempdir."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]


class UpdaterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        subprocess.run([sys.executable,str(ROOT/'scripts/build_profile_v2_update.py')],check=True,stdout=subprocess.DEVNULL)

    def setUp(self):
        spec=importlib.util.spec_from_file_location('profile_update_case',ROOT/'build/update_sonnenpfad_profile_v2.py')
        self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name);self.target=self.base/'api-stage2';self.target.mkdir()
        (self.target/'app.py').write_text('old stage 2');self.unit=self.base/'unit.service'
        self.unit_text='[Service]\n'+self.module.UNIT_MARKER+'\nMemoryMax=512M\nCPUQuota=50%\n';self.unit.write_text(self.unit_text)
        for key,value in {'BASE':self.base,'TARGET':self.target,'UNIT':self.unit}.items():
            patcher=patch.object(self.module,key,value);patcher.start();self.addCleanup(patcher.stop)
        for target,value in [(self.module.os,'geteuid'),(self.module.pwd,'getpwnam')]:
            patcher=patch.object(target,value,return_value=0);patcher.start();self.addCleanup(patcher.stop)
        self.calls=[];self.fail_smoke=False
        for target,name,effect in [(self.module,'run',self.fake_run),(self.module.subprocess,'run',self.fake_run)]:
            patcher=patch.object(target,name,side_effect=effect);patcher.start();self.addCleanup(patcher.stop)
        self.version=patch.object(self.module,'health_version',return_value=self.module.VERSION);self.version.start();self.addCleanup(self.version.stop)

    def fake_run(self,args,**kwargs):
        self.calls.append(args)
        if self.fail_smoke and args[-1]=='smoke_v2.py':raise subprocess.CalledProcessError(1,args)
        return types.SimpleNamespace(returncode=0)

    def systemctl(self):return [args for args in self.calls if args[0]=='systemctl']

    def test_update_replaces_only_stage_two_and_keeps_backup(self):
        self.module.update()
        for name,data in self.module.payload().items():self.assertEqual((self.target/name).read_bytes(),data)
        backups=list(self.base.glob('api-stage2.prev-*'));self.assertEqual(len(backups),1)
        self.assertEqual((backups[0]/'app.py').read_text(),'old stage 2')
        self.assertEqual(self.systemctl(),[['systemctl','daemon-reload'],['systemctl','restart','sonnenpfad-profile-v2.service']])
        self.assertIn('MemoryMax=1G\nCPUQuota=100%',self.unit.read_text());self.assertIn(self.module.UNIT_MARKER,self.unit.read_text())
        self.assertTrue(all('sonnenpfad-api.service' not in args and 'nginx' not in ' '.join(args) for args in self.calls))

    def test_failed_smoke_rolls_back_to_previous_stage_two(self):
        self.fail_smoke=True
        with self.assertRaises(subprocess.CalledProcessError):self.module.update()
        self.assertEqual((self.target/'app.py').read_text(),'old stage 2')
        self.assertEqual(len(list(self.base.glob('api-stage2.failed-*'))),1)
        self.assertEqual(self.unit.read_text(),self.unit_text)
        restart=[['systemctl','daemon-reload'],['systemctl','restart','sonnenpfad-profile-v2.service']]
        self.assertEqual(self.systemctl(),restart*2)

    def test_unexpected_unit_changes_nothing(self):
        self.unit.write_text('[Service]\nWorkingDirectory=/elsewhere\nMemoryMax=512M\nCPUQuota=50%\n')
        with self.assertRaises(ValueError):self.module.update()
        self.assertEqual(self.calls,[]);self.assertEqual((self.target/'app.py').read_text(),'old stage 2')

    def test_identical_running_update_is_idempotent(self):
        for name,data in self.module.payload().items():(self.target/name).write_bytes(data)
        self.unit.write_text(self.module.unit_with_limits(self.unit_text))
        self.module.update();self.assertEqual(self.calls,[])
        self.assertEqual(list(self.base.glob('api-stage2.prev-*')),[])


if __name__=='__main__':
    unittest.main()
