# How to contribute to 3DStreet

We welcome community contributions to 3dstreet.

## Instructions
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

### About 3dstreet test

A small portion of 3dstreet code is tested. All of this code lives in this directory [/src/tested/](https://github.com/3DStreet/3dstreet/tree/main/src/tested)

When running `npm run test` it uses tests located in [this directory /test](https://github.com/3DStreet/3dstreet/tree/main/test). 

If you have made changes to code that has test coverage, you will need to update the corresponding test in that directory.

## License for contributed works
3DStreet license information can be found here: [LICENSE](https://github.com/3DStreet/3dstreet/blob/main/LICENSE)

We follow the GitHub terms of service for assigning your contributed code the same license as this repository. Those terms are pasted here for convenience, [here is a direct link to GitHub's terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#6-contributions-under-repository-license
).

> Whenever you make a contribution to a repository containing notice of a license, you license your contribution under the same terms, and you agree that you have the right to license your contribution under those terms. If you have a separate agreement to license your contributions under different terms, such as a contributor license agreement, that agreement will supersede.

> Isn't this just how it works already? Yep. This is widely accepted as the norm in the open-source community; it's commonly referred to by the shorthand "inbound=outbound". We're just making it explicit.
