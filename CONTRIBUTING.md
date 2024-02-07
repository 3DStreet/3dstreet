# How to contribute to 3DStreet

We welcome community contributions to 3DStreet.

## Release checklist for this repo:
- After all testing is done and things work well enough for a release.
- Bump the version on package.json & package-lock.json (for example from 0.4.2 to 0.4.4)
- Re-run npm run dist (rerun the build, it hardcodes the version into global var used for console log)
- Commit this all to the repo
- Use command line to create new tag for new version `git tag 0.4.4` and `git push --tags`
- Create a new release here: https://github.com/3DStreet/3dstreet/releases/new. Choose the tag you just created. (If needed for the title simply use the new version such as "0.4.4")
- Click to automatically "generate release notes." Consider summarizing a few key changes to put at the top.
- Update https://www.3dstreet.org/docs/development/releases/ with summary of major improvements and linking back to the new release on github.
- Then to run npm publish after all github version stuff works

## Updating assets submodule:
- from the repo's root directory run `git submodule update --remote` to update the assets submodule

## Contribution Instructions
* fork the repo
* make your contribution
* make sure to do check for linting and unit test:
* `npm run lint` should have no errors. You can try `npm run lint:fix` to automatically fix errors. sometimes you need to manually fix the errors
* `npm run test` should return all passing or pending, no failures. See below for how to handle test failures
* If linting and tests all pass, then create a pull request to merge into main 3dstreet repo with a description of the changes and a link to an associated issue if any.
* Notify us on the 3dstreet discord if you don't hear a reply within a few days or want a faster review

### If failed test:
* Either change your code so that the test passes once again, or
* You might need to update the tests

### About 3DStreet test

A small portion of 3dstreet code is tested. All of this code lives in this directory [/src/tested/](https://github.com/3DStreet/3dstreet/tree/main/src/tested)

When running `npm run test` it uses tests located in [this directory /test](https://github.com/3DStreet/3dstreet/tree/main/test). 

If you have made changes to code that has test coverage, you will need to update the corresponding test in that directory.

## License for contributed works
3DStreet license information can be found here: [LICENSE](https://github.com/3DStreet/3dstreet/blob/main/LICENSE)

We follow the GitHub terms of service for assigning your contributed code the same license as this repository. Those terms are pasted here for convenience, [here is a direct link to GitHub's terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#6-contributions-under-repository-license
).

> Whenever you make a contribution to a repository containing notice of a license, you license your contribution under the same terms, and you agree that you have the right to license your contribution under those terms. If you have a separate agreement to license your contributions under different terms, such as a contributor license agreement, that agreement will supersede.

> Isn't this just how it works already? Yep. This is widely accepted as the norm in the open-source community; it's commonly referred to by the shorthand "inbound=outbound". We're just making it explicit.
