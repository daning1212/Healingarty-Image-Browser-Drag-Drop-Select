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
        self.assertEqual(cls.RETURN_TYPES,('IMAGE','IMAGE','MASK','MASK'))
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
    def test_crop_exact_pixels_resize_and_source_preserved(self):
        import numpy as np
        image = Image.fromarray(np.arange(8*6*3, dtype=np.uint8).reshape(6,8,3))
        state = {'path':'source.png','size':[8,6],'box':[2,1,6,5],'max_edge':0}
        before = image.tobytes()
        cropped = self.module.process_crop(image,state)
        self.assertEqual(cropped.size,(4,4))
        self.assertEqual(cropped.getpixel((0,0)),image.getpixel((2,1)))
        self.assertEqual(image.tobytes(),before)
        state['max_edge']=2
        self.assertEqual(self.module.process_crop(image,state).size,(2,2))
        state['max_edge']=100
        self.assertEqual(self.module.process_crop(image,state).size,(4,4))
        state['size']=[9,6]
        with self.assertRaises(ValueError): self.module.process_crop(image,state)

    def test_crop_state_validation_and_independent_output(self):
        import json
        import numpy as np
        a=self.base/'a.png';b=self.base/'b.png'
        Image.new('RGB',(8,6),'red').save(a);Image.new('RGB',(10,20),'blue').save(b)
        state={'path':str(b),'size':[10,20],'box':[2,2,8,18],'max_edge':8}
        raw=json.dumps(state);cls=self.module.HealingartyImageBrowser
        self.assertTrue(cls.VALIDATE_INPUTS(str(a),raw))
        prior=sys.modules.get('torch')
        class Tensor:
            def __init__(self,array): self.array=array
            def unsqueeze(self,axis): return np.expand_dims(self.array,axis)
        sys.modules['torch']=types.SimpleNamespace(from_numpy=Tensor)
        try:
            original,crop,original_mask,crop_mask=cls().load_selected(str(a),raw)
            self.assertEqual(original.shape,(1,6,8,3));self.assertEqual(crop.shape,(1,8,3,3))
            np.testing.assert_array_equal(crop[0,0,0],[0,0,1])
            restored=cls().load_selected('',raw)
            self.assertEqual(restored[1].shape,crop.shape)
        finally:
            if prior is None: sys.modules.pop('torch',None)
            else: sys.modules['torch']=prior
        before=cls.IS_CHANGED(str(a),raw)
        Image.new('RGB',(10,20),'green').save(b)
        self.assertNotEqual(before,cls.IS_CHANGED(str(a),raw))
        state['box']=[0,0,0,1]
        self.assertIsInstance(cls.VALIDATE_INPUTS(str(a),json.dumps(state)),str)
        for invalid in ['[]','{}','null','{"path":"x","size":[1,1],"box":[0,0,1,1],"max_edge":-1}']:
            with self.assertRaises(ValueError): self.module.parse_crop_state(invalid)

    def test_large_preview_uses_original_and_caps_resolution(self):
        source=self.base/'large.png';Image.new('RGB',(3000,1500),'green').save(source)
        data,width,height=self.module.large_preview(str(source))
        self.assertEqual((width,height),(3000,1500))
        import io
        with Image.open(io.BytesIO(data)) as preview:
            self.assertEqual(preview.size,(2048,1024))
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
    def load_with_tensor_adapter(self, path, state=''):
        import numpy as np
        from unittest.mock import patch
        class Tensor:
            def __init__(self, array): self.array = array
            def unsqueeze(self, axis): return np.expand_dims(self.array, axis)
        with patch.dict(sys.modules, {'torch': types.SimpleNamespace(from_numpy=Tensor)}):
            return self.module.HealingartyImageBrowser().load_selected(path, state)

    def test_rgba_mask_values_shape_and_alpha_roundtrip(self):
        import numpy as np
        image=Image.new('RGBA',(4,2),(20,40,60,255))
        for x,a in enumerate([0,64,128,255]):image.putpixel((x,0),(20,40,60,a))
        path=self.base/'alpha.png';image.save(path);before=path.read_bytes()
        original,crop,mask,crop_mask=self.load_with_tensor_adapter(str(path))
        self.assertEqual(original.shape,(1,2,4,3));self.assertEqual(mask.shape,(1,2,4))
        self.assertEqual(mask.dtype,np.float32)
        expected=1-np.asarray(image.getchannel('A'),dtype=np.float32)/255
        np.testing.assert_allclose(mask[0],expected)
        np.testing.assert_allclose((1-mask[0])*255,np.asarray(image.getchannel('A')),atol=0.0001)
        self.assertIs(original,crop);self.assertIs(mask,crop_mask)
        self.assertEqual(path.read_bytes(),before)

    def test_jpeg_and_opaque_png_masks_are_full_size_zero(self):
        import numpy as np
        for mode,extension,color in [('RGB','jpg',(30,50,70)),('RGBA','png',(30,50,70,255))]:
            path=self.base/('opaque.'+extension);Image.new(mode,(7,5),color).save(path)
            _,_,mask,crop_mask=self.load_with_tensor_adapter(str(path))
            self.assertEqual(mask.shape,(1,5,7));self.assertIs(mask,crop_mask)
            np.testing.assert_array_equal(mask,np.zeros((1,5,7),dtype=np.float32))

    def test_independent_crop_mask_matches_image_resize_and_restores(self):
        import json
        import numpy as np
        a=self.base/'mask_original.jpg';Image.new('RGB',(5,4),'red').save(a)
        b=self.base/'mask_crop.png';image=Image.new('RGBA',(8,6),(15,25,35,255))
        alpha=Image.fromarray(np.arange(48,dtype=np.uint8).reshape(6,8)*5);image.putalpha(alpha);image.save(b)
        state={'path':str(b),'size':[8,6],'box':[1,1,7,5],'max_edge':3}
        original,crop,mask,crop_mask=self.load_with_tensor_adapter(str(a),json.dumps(state))
        self.assertEqual(mask.shape,original.shape[:3]);self.assertEqual(crop_mask.shape,crop.shape[:3])
        self.assertEqual(crop.shape,(1,2,3,3));self.assertEqual(float(mask.max()),0)
        expected=alpha.crop((1,1,7,5)).resize((3,2),Image.Resampling.LANCZOS)
        np.testing.assert_allclose(crop_mask[0],1-np.asarray(expected,dtype=np.float32)/255)
        expected_rgb=self.module.process_crop(image.convert('RGB'),state)
        np.testing.assert_allclose(crop[0],np.asarray(expected_rgb,dtype=np.float32)/255)
        restored=self.load_with_tensor_adapter('',json.dumps(state))
        np.testing.assert_allclose(restored[3],crop_mask)
        self.assertEqual(restored[2].shape,(1,6,8))

    def test_palette_rgb_transparency_and_grayscale_alpha(self):
        import numpy as np
        for mode in ['P','RGB','LA']:
            path=self.base/('transparent_'+mode+'.png')
            if mode=='P':
                image=Image.new('P',(2,1));image.putpalette([255,0,0,0,255,0]+[0]*762);image.putdata([0,1]);image.save(path,transparency=0)
            elif mode=='RGB':
                image=Image.new('RGB',(2,1),'red');image.putpixel((1,0),(0,255,0));image.save(path,transparency=(255,0,0))
            else:
                image=Image.new('LA',(2,1),(100,0));image.putpixel((1,0),(100,255));image.save(path)
            mask=self.load_with_tensor_adapter(str(path))[2]
            np.testing.assert_array_equal(mask,np.array([[[1,0]]],dtype=np.float32))

    def test_exif_orientation_applies_to_image_and_mask_together(self):
        import json
        import numpy as np
        from PIL import ImageOps
        image=Image.new('RGBA',(3,2),(15,25,35,255));image.putpixel((0,0),(15,25,35,0))
        exif=Image.Exif();exif[274]=6
        path=self.base/'rotated_alpha.png';image.save(path,exif=exif)
        with Image.open(path) as opened:
            expected=ImageOps.exif_transpose(opened).getchannel('A')
        state={'path':str(path),'size':[2,3],'box':[0,0,2,3],'max_edge':0}
        original,crop,mask,crop_mask=self.load_with_tensor_adapter(str(path),json.dumps(state))
        self.assertEqual(original.shape,(1,3,2,3));self.assertEqual(mask.shape,(1,3,2))
        np.testing.assert_allclose(mask[0],1-np.asarray(expected,dtype=np.float32)/255)
        np.testing.assert_allclose(crop_mask,mask)

if __name__=='__main__': unittest.main()
