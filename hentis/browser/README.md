# Native mobile regression

The mobile UI runs the complete Plane frontend, sharing routes, forms, stores and permission checks with desktop. It has no separate API client or phone-frame preview.

The navigation drawer exposes workspace destinations, favorites, all authorized projects and their enabled features. The bottom bar opens native search, notifications and issue creation. Issue content, properties, activity and attachments use separate tabs on small screens; mounted editors retain their drafts across tab and viewport changes. Native page tools, cycle/module Gantt, menus, settings, custom fields and AI remain reachable on touch screens.

## Run locally

After the root frozen install:

```sh
pnpm exec turbo run build --filter='web^...'
pnpm --filter @plane/i18n exec tsx --test ../../hentis/tests/i18n-resources.test.mjs
pnpm --filter web check:types
pnpm --filter web build
npm ci --prefix hentis/browser --ignore-scripts
node hentis/browser/node_modules/playwright/cli.js install chromium
npm test --prefix hentis/browser
```

On Windows, invoke Turbo through Node rather than a `.cmd` wrapper if the shell consumes the caret in its filter. The browser runner serves the compiled app locally, mocks every API request and blocks external requests. `CHROME_PATH` selects an installed Chrome; `PLAYWRIGHT_MODULE` selects a Playwright installation. `PLANE_TEST_LANGUAGE=pt-BR` repeats the browser scenarios in Brazilian Portuguese. Screenshots and request reports go to the ignored `output/` folder.

Checks cover navigation destinations, native search and creation dialogs, profile tabs, route rendering, Gantt availability, custom-field save/cancel and drafts across 320/390/768/1440px viewports. Unexpected browser runtime errors fail the run. `PLANE_TEST_DIAGNOSTIC=1` is for investigation only and does not constitute a passing regression run.

These fixture tests do not certify production authentication, collaboration, uploads or every create/update/delete operation. Before deployment, use a permitted test account/project to verify those flows and license/role-specific features on an actual phone.

## Publish

Merge the responsive frontend into `hentis/custom-fields`, generate the normal validated image release, prepare the deployment candidate in `Hantking/plane` and validate the main domain first. Only then publish the mobile entry change. That entry redirects `m.plane.hentis.com.br` to `plane.hentis.com.br`, preserving native paths and using the main domain's existing login. It also retires the old partial app's service worker. Creating a PR or building an image does not deploy either service.
