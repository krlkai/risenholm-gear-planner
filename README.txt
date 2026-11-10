Risenholm Gear Planner

Hosting

Extract the ZIP and upload its web files together to a folder on the site,
such as /gear-planner/. README.txt is for the host.
Link to /gear-planner/ if the server serves index.html as its directory
index. Otherwise, link directly to /gear-planner/index.html.
Keep the filenames and relative paths intact.

Serve the files over HTTPS with standard MIME types, including
text/javascript for the JavaScript modules, application/json for the
catalog, and image/svg+xml for the icon. The planner is a static site
with no build step or backend.

Loadouts

The package contains the planner and no bundled loadouts. On first visit
the planner opens with a blank loadout. It saves changes in the player's
browser, scoped to the site's origin and the planner's folder. Use a
private browser window to preview a first visit.
Loadouts shows the date and time of the last edit. Older loadouts without
a saved edit time show Date unavailable until edited.
Add portrait in the toolbar accepts JPEG, PNG, and WebP. A portrait is
saved with that loadout and included in JSON and PNG exports. Loadouts
shows attached portraits. Select a loadout name or portrait to open it.
Hover over or select the portrait in the planner header to replace or
remove it.
Players can export a JSON file from the Export plan menu and import it
through Loadouts to move a build from another copy of the planner.
Export plan > Download PNG creates a shareable image with the full
loadout and notes embedded. Loadouts > Import JSON or PNG accepts the
original exported PNG. Screenshots and images stripped of metadata
do not contain an importable build.

Maintenance

risenholm-icon.svg contains the supplied Risenholm Discord emblem.
The header and browser tab use this same file.

The planner checks the public Risenholm wiki when opened, at most once per
hour per browser after a successful check. It applies compatible changes
to property tables, non-ranged gear bases, and skills. If the wiki is
unreachable or its table format changes, the planner uses the last
working catalog. catalog.json is the bundled fallback.

If your host sets a Content-Security-Policy, allow
https://wiki.risenholm.com in connect-src alongside the site itself.
Allow data: and blob: in img-src for locally processed portraits.
The wiki receives anonymous read requests for two public pages.

engine.js handles gear rules, Capacity, and stat totals. Rule changes
described in prose and new property types may need a code update. The
planner covers helm, bracers, cloak, two rings, belt, amulet, boots, armor,
and the main-hand melee weapon. Shields and ranged slots are outside its scope.

The in-app How it works page records the sources and rules that still need
in-game verification. It also shows the active revisions of the Equipment
and Itemization and Skills pages.

https://wiki.risenholm.com/index.php/Equipment_and_Itemization
https://wiki.risenholm.com/index.php/Skills
