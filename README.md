# BridgeLab

[Open the site](https://chronicat.github.io/bridgelab/) · [Field inspection](https://chronicat.github.io/bridgelab/field/) · [Review](https://chronicat.github.io/bridgelab/field/review.html) · [Blind trials](https://chronicat.github.io/bridgelab/field/validation.html)

BridgeLab follows a field reference through live camera images or a local video. The homepage includes a teaching truss and an exterior reconstruction of Waibaidu Bridge. [Explore the reconstruction and its sources](https://chronicat.github.io/bridgelab/models/waibaidu.html) or [download the GLB](models/waibaidu.glb). The [desktop bridge walk](https://chronicat.github.io/bridgelab/target/) renders the two-span model live. The viewpoint moves along the bridge, and four joints provide controlled examples of gradual displacement. The [interactive model page](https://chronicat.github.io/bridgelab/models/waibaidu.html) includes a photograph by Suicasmo for visual comparison. The reconstruction uses two 52.178 m spans, 11 panels per span, 9.144 m midspan truss depth and 12.192 m main truss spacing from the [published repair design](https://doc.xuehai.net/b1ddf795ae8994a953c8c2695-2.html). Field measurements use the reference images captured for each site. No surveyed Waibaidu coordinates or on-site measurements are bundled.

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

## Film a simulated bridge walk

Open the [desktop walk](https://chronicat.github.io/bridgelab/target/index.html?v=wb5). Play or scrub the route, rotate the model, and compare the different deformation settings. The 76.4 m virtual traverse starts 14 m from the model origin. Position on the model and distance walked by the person holding the phone have separate readings.

Scan the desktop QR code or open the [phone camera](https://chronicat.github.io/bridgelab/target/mobile.html?v=wb5). Record while the desktop travels along the bridge. The phone uses the fixed, coloured joints on the truss to position its overlay. It measures four independent targets as they enter the view. Confirmed movement triggers a location-specific alert. Finishing the recording opens the video and a summary with the observed bridge coverage, distinct alerts and largest measured offset in reference-image pixels. The optional GPS setting estimates the phone’s walking distance when location quality permits.

For a real bridge, save section reference photographs first in [Field inspection](https://chronicat.github.io/bridgelab/field/), then use **Record a field video**. Model-bound references enable the projected model overlay. A field pixel reading compares with the saved reference. The field inspection’s existing calibrated workflow provides qualified metric measurements when its calibration conditions are met.

The [six-marker calibration board](https://chronicat.github.io/bridgelab/target/markers.html?v=wb4) remains available for marker-based tabletop AR with its own camera link.
