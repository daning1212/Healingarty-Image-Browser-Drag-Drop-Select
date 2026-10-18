import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
class BackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.base = Path(cls.temp.name)
        cls.input = cls.base / 'input'
        cls.input.mkdir()
        sys.modules['folder_paths'] = types.SimpleNamespace(get_input_directory=lambda: str(cls.input), get_output_directory=lambda: str(cls.base))
        class Routes:
            def get(self, path): return lambda f: f
            post = get
        sys.modules['server'] = types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(routes=Routes())))
        spec = importlib.util.spec_from_file_location('browser_backend', ROOT / '__init__.py')
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)
    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()
    def test_pages_search_and_folders(self):
        folder=self.base/'gallery';folder.mkdir(exist_ok=True)
        (folder/'sub').mkdir(exist_ok=True)
        for n in range(5): (folder/f'{n}.png').touch()
        data=self.module.browse(str(folder),0,2)
        self.assertTrue(data['items'][0]['directory'])
        self.assertEqual(data['next'],2)
        self.assertEqual(len(self.module.browse(str(folder),query='3')['items']),1)
    def test_persistent_tree_ancestors_and_pagination(self):
        folder=self.base/'tree';folder.mkdir(exist_ok=True)
        for i in range(125): (folder/f'folder{i:03}').mkdir(exist_ok=True)
        (folder/'image.png').touch()
        data=self.module.folder_tree(str(folder))
        self.assertEqual(data['ancestors'][-1]['path'],str(folder))
        self.assertEqual(len(data['children']),120)
        self.assertEqual(data['next'],120)
        self.assertEqual(len(self.module.folder_tree(str(folder),120)['children']),5)
        child=self.module.folder_tree(str(folder/'folder000'))
        self.assertEqual(child['ancestors'][-2]['path'],str(folder))
    def test_selected_output_and_cache_changes(self):
        import numpy as np
        source=self.base/'selected.png';Image.new('RGB',(4,3),(255,0,0)).save(source)
        cls=self.module.HealingartyImageBrowser
        self.assertEqual(cls.RETURN_TYPES,('IMAGE',))
        self.assertTrue(cls.VALIDATE_INPUTS(str(source)))
        self.assertIsInstance(cls.VALIDATE_INPUTS(''),str)
        before=cls.IS_CHANGED(str(source))
        class Tensor:
            def __init__(self,array): self.array=array
            def unsqueeze(self,axis): return np.expand_dims(self.array,axis)
        prior=sys.modules.get('torch')
        sys.modules['torch']=types.SimpleNamespace(from_numpy=Tensor)
        try:
            result=cls().load_selected(str(source))[0]
            self.assertEqual(result.shape,(1,3,4,3))
            np.testing.assert_array_equal(result[0,0,0],[1,0,0])
        finally:
            if prior is None: sys.modules.pop('torch',None)
            else: sys.modules['torch']=prior
        Image.new('RGB',(4,3),'blue').save(source)
        self.assertNotEqual(before,cls.IS_CHANGED(str(source)))
    def test_thumbnail_and_non_destructive_import(self):
        source=self.base/'한글.png';Image.new('RGB',(640,480),'red').save(source)
        before=source.read_bytes()
        data,w,h=self.module.thumbnail(str(source))
        self.assertEqual((w,h),(640,480))
        self.assertTrue(data.startswith(b'\xff\xd8'))
        value=self.module.import_image(str(source))
        self.assertEqual((self.input/value).read_bytes(),before)
        self.assertEqual(source.read_bytes(),before)
        self.assertEqual(self.module.import_image(str(source)),value)
    def test_existing_input_and_invalid_file(self):
        source=self.input/'existing.png';Image.new('RGB',(2,2)).save(source)
        self.assertEqual(self.module.import_image(str(source)),'existing.png')
        bad=self.base/'bad.png';bad.write_text('invalid')
        with self.assertRaises(OSError): self.module.import_image(str(bad))
        with self.assertRaises(ValueError): self.module.image_path(str(self.base))
if __name__=='__main__': unittest.main()
