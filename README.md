# BridgeLab

[Open the site](https://chronicat.github.io/bridgelab/) · [Field inspection](https://chronicat.github.io/bridgelab/field/) · [Review](https://chronicat.github.io/bridgelab/field/review.html) · [Blind trials](https://chronicat.github.io/bridgelab/field/validation.html)

BridgeLab follows a field reference through live camera images or a local video. The homepage includes two schematic 3D models. Field measurements use the reference images captured for each site. No surveyed Waibaidu coordinates or on-site measurements are bundled.

## Walk a route

1. Select an existing bridge or create a project. Under **Section baselines**, use a reference photo or freeze a camera frame. Name the member or section. In automatic mode, tap the monitoring target and inspect the four proposed fixed features and the independent check. Choose features that are physically stable relative to the measurement and in the same plane as the target. A distinctive mark helps distinguish repeated bays.
2. Save references for the planned sections. For adjoining manual references you can identify a shared edge. Both of its landmarks must agree when the two sections are recognized together. Every section is also registered against its own archived image. The operator can then open the camera and walk the route without selecting nodes. The app pauses readings on loss of registration or ambiguous matches.
3. Finish the walk and open **Records**. Select an alert for the original reference, observed frame and recorded overlay. The run includes localization transitions, time coverage, lost observations, independent-check error and the exact reference revision. Use the JSON archive to back up the project or move it to another browser. Camera frames and reference photos stay on the device unless the operator exports the archive. Browser site-data deletion removes local records.

## Measure a controlled displacement

For a physical planar test, select **Measured rectangular plane** and enter the independently measured rectangle width and height. Pick upper left, upper right, lower right, lower left, a stable check and a separate movable target. Keep all six coplanar. Plane X points from the first to the second corner and Y from the first to the fourth. Displacement is relative to the chosen plane. A common displacement of all landmarks and motion normal to the plane require other observations.

Set the review threshold for that measured section. In **Blind test**, arm a physical-camera trial. Have a second person set the target to zero or an independently measured offset in randomized order. Keep the target at that position throughout the eight-second sample. Vary camera motion, viewpoint, and distance across runs. The monitor hides estimates until the capture is sealed. Enter the independent planar shift and how it was measured afterward. Repeat both zero and displaced trials. The trial page shows empirical errors, misses, false alerts per minute and the time and frame coverage, including unusable captures.

The current camera, working scale, viewing geometry, section revision and test records determine whether the app can show a qualified millimetre reading. A valid physical profile applies only within the observed conditions. Otherwise a verified frame can give a pixel screening result. A persistent 7-pixel difference is a review trigger at the working image resolution. It is not a structural limit. The reference trace indicates relative visual change and does not establish a damage diagnosis.

## Reproduce a run

**Simulate a walk** exercises the field pipeline with two generated sections, camera movement, target shifts, loss of view and a return visit. It creates a separately labelled synthetic record. The screen target and original 3D replay are available on the homepage. The printable board has English and Chinese versions. On site, record a repeat walk and score section identities against an independent log. On the fixture, use independently measured displacement for accuracy testing. The synthetic inputs and software regressions provide no field precision estimates.

The static site runs from the repository root on GitHub Pages. Use HTTPS for camera access. Tests require Node.js 22.7+ and can be run with `node --test tests/*.mjs`.

## Try the miniature on two devices

On a computer open the [screen target](https://chronicat.github.io/bridgelab/target/), select a bridge, choose **Connect phone** and scan the QR code. Close the code using **Show board**. The phone opens the matched AR camera and downloads that bridge's 3D geometry from this site. **View 3D model** works independently of camera permission or tracking. Four distinct stationary corner codes anchor the miniature. A separate check and target gate the pixel measurement. Move the target on the computer or change the viewing angle. Partial recognition shows a count and specific guidance. The [optical simulation](https://chronicat.github.io/bridgelab/ar/?mode=board-demo&bridge=waibaidu) exercises this same decoder and pose/render path without a camera.

In **Field inspection**, the 3D model panel loads the built-in model for the selected bridge. To align the schematic at a physical section, choose **Link a 3D model panel** when making a reference, select the near or far panel and tap the corresponding joints in the indicated order, followed by a stable check and a separate target in the same plane. Reverse the node order when the span runs right to left in the photo. Once the section is recognized, a consistent pose draws its model in the camera feed. This visual fit uses approximate camera intrinsics. The reference-image measurement remains independent of the overlay. An as-built model and surveyed correspondences are required to interpret a difference against the actual bridge.

For a custom project, **Import model JSON** accepts a local model up to 5 MB with an `id`, a `nodes` array of `{id,xyz:[x,y,z]}` and a `members` array of `{a,b}` node pairs. Model geometry without panels can be rotated in the viewer. To enable camera registration, include `fieldFaces` with `{id,name,corners:[upperLeft,upperRight,lowerRight,lowerLeft]}` entries naming four actual coplanar model nodes around each panel. The model and its reference bindings travel with the site's exported archive. Import the archive on another device to use custom assets there.
