"""Render de verificación del activo GLB; no controla ninguna aplicación o navegador."""
import sys
from pathlib import Path
import vtkmodules.vtkRenderingOpenGL2
from vtkmodules.vtkRenderingCore import vtkRenderWindow, vtkWindowToImageFilter, vtkLight
from vtkmodules.vtkIOImport import vtkGLTFImporter
from vtkmodules.vtkIOImage import vtkPNGWriter

window=vtkRenderWindow()
window.SetOffScreenRendering(1)
window.SetShowWindow(False)
window.SetSize(1400,1100)
reader=vtkGLTFImporter()
reader.SetFileName(str(Path(sys.argv[1]).resolve()))
reader.SetRenderWindow(window)
reader.Update()
renderer=window.GetRenderers().GetFirstRenderer()
renderer.SetBackground(.94,.96,.98)
renderer.SetAutomaticLightCreation(False)
for pos,intensity in [((.6,-.2,.8),.9),((-.3,.6,.5),.7),((.2,.5,.9),.5)]:
 light=vtkLight();light.SetLightTypeToSceneLight();light.SetPosition(*pos);light.SetFocalPoint(.1,.25,.08);light.SetIntensity(intensity);renderer.AddLight(light)
actors=renderer.GetActors();actors.InitTraversal()
for _ in range(actors.GetNumberOfItems()):
 actor=actors.GetNextActor();actor.GetProperty().SetAmbient(.22)
camera=renderer.GetActiveCamera()
camera.SetViewUp(0,0,1)
camera.SetPosition(.85,-.55,.8)
camera.SetFocalPoint(.1,.25,.08)
renderer.ResetCamera()
renderer.ResetCameraClippingRange()
window.Render()
capture=vtkWindowToImageFilter();capture.SetInput(window);capture.ReadFrontBufferOff();capture.Update()
writer=vtkPNGWriter();writer.SetFileName(str(Path(sys.argv[2]).resolve()));writer.SetInputConnection(capture.GetOutputPort());writer.Write()
print('Render guardado',sys.argv[2],flush=True)
window.Finalize()
