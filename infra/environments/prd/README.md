# Yatalk hackathon PRD environment

Yatalk is a hackathon prototype, so this is its only Terraform environment. Keeping one environment avoids duplicate cloud services and costs. It targets Google Cloud project `s-yatalk`. Terraform manages the Vertex AI and Cloud Quotas APIs, Cloud Run, Artifact Registry, Cloud Build, PayPal Sandbox and organizer secret metadata. Gemini uses the `global` Vertex AI endpoint because the selected Flash-Lite model's Standard PayGo endpoint is global; processing is not limited to Tokyo.

This Terraform root now stores state under `yatalk/prd` in the existing protected bucket `yatalk-dev-tfstate-s-yatalk`. Existing cloud resource IDs keep their `dev` names, including `yatalk-dev-preview`, to preserve the deployed preview without creating a second service or state bucket.

The state bucket must exist before Terraform can initialize its GCS backend. It was created with a temporary Terraform bootstrap configuration and then imported into this environment's remote state. Keep the bucket; `prevent_destroy` protects it from accidental removal.

## Apply

Authenticate with Application Default Credentials and use Terraform 1.17.1:

```sh
gcloud auth application-default login
terraform init
terraform plan
terraform apply
```

If Application Default Credentials use a quota project other than `s-yatalk`, set `GOOGLE_CLOUD_QUOTA_PROJECT=s-yatalk` for the Terraform commands so Google API quota checks use this environment's project.

## Optional custom domain

`yatalk.kumagaias.com` serves the web app and its API on one origin, including `/api/*`. The root domain is already verified in project `s-yatalk`, so Cloud Run can map this hostname directly to the preview service without a load balancer.

Cloud Run domain mapping is a Preview feature with limitations and is not recommended for production use. Google also documents high-latency issues for mapped domains in `asia-northeast1`; this setup serves the hackathon preview. See [Cloud Run custom domains](https://docs.cloud.google.com/run/docs/mapping-custom-domains) and [known issues](https://docs.cloud.google.com/run/docs/known-issues).

Current preview: DNS and the managed certificate are ready, `app_origin` is `https://yatalk.kumagaias.com`, and the PayPal Sandbox webhook has been moved and verified on that host. The default `run.app` URL is disabled; the Cloud Run service remains public through the domain mapping. Headless checks confirmed the homepage and `/api/health` return 200.

To prepare the mapping without changing the current browser origin, keep `app_origin` set to the Cloud Run URI and add `enable_custom_domain = true` to `prd.auto.tfvars`:

```hcl
enable_cloud_run_service = true
enable_public_access     = true
enable_custom_domain     = true
app_origin               = "https://<exact-cloud-run-service-uri>"
```

Apply the mapping while `disable_default_run_app_url` remains false. Read `terraform output -json custom_domain_dns_records` and add each reported type and record data in the separate `kumagaias-com-infra` Route 53 Terraform root under `yatalk.kumagaias.com`. Wait for DNS propagation and the managed certificate/route to become ready, then change `app_origin` to `https://yatalk.kumagaias.com`; the site and `/api/*` now share the same exact browser origin. Move the PayPal Sandbox webhook to `https://yatalk.kumagaias.com/api/webhooks/paypal`, verify a signed event, and update any monitors to the custom hostname. Keep Cloud Run ingress unchanged during that cutover.

Only after those checks pass, you may set `disable_default_run_app_url = true` in `prd.auto.tfvars`. Terraform validation requires the domain mapping, public access, and exact custom `app_origin` before it disables the default URI. Do not disable it while the PayPal webhook or any monitor still uses the `run.app` URL.

Run these commands from this directory. The GCS backend stores state at `yatalk/prd/default.tfstate` and enables state locking. The existing bucket has uniform bucket-level access, public access prevention, object versioning, and no force destroy. The previous `yatalk/dev` state object is retained as a backup after migration.

The Vertex AI API must be enabled before Gemini requests work. Model requests are billed to the project's linked billing account.

## Cloud Run development preview

This is a single-instance development preview, not production hosting. It uses PayPal Sandbox and the global Vertex AI Gemini endpoint. Shop accounts, storefronts, menus, carts, and orders use the Firestore Standard default database in `asia-northeast1`, so they survive Cloud Run restarts and revisions. Firestore has a usage-based free quota for one database per project: currently 1 GiB stored data, 50,000 reads, 20,000 writes, and 20,000 deletes per day, plus 10 GiB monthly outbound transfer. Usage above the free quota is billed; managed TTL deletions for expired sessions and carts are not included. See [Firestore pricing](https://cloud.google.com/firestore/pricing) and [quotas](https://docs.cloud.google.com/firestore/quotas) for current terms. The existing ¥5,000 budget is an alert, not a spending cap. The app's per-IP and per-session rate limits still live in process memory.

This rollout did not import data from the preview's old temporary SQLite file. At cutover, the public `test` shop menu returned 404. Any owner login or custom shop held only in that SQLite file is not present in Firestore; the owner may need to register again. Firestore starts with the seeded sample storefront.

The preview grants public invocation and its Gemini routes incur Vertex AI usage charges. Terraform declares project-level global input-token quota preferences for `gemini-3.5-flash-lite-qcd` at 10,000 tokens per minute and 50,000 tokens per day. After applying, verify `granted_value` and `reconciling` before relying on the limits. These preferences limit input tokens only: output tokens and other project charges remain billable. Terraform protects both preferences from accidental deletion because the Cloud Quotas API does not support deleting them; change the preferred value to adjust a limit. Terraform also creates a ¥5,000 monthly budget alert for this project at 50%, 80%, 100%, and forecasted 100%; notifications go to billing account users and administrators. The budget alert does not stop spending. Current per-IP and per-session limits are held in process memory and reset when the instance restarts; distributed clients can also spread requests across IPs.

Terraform creates PayPal and organizer secret metadata only; it never manages secret payloads or versions. The Cloud Run runtime service account can read the two PayPal client secrets, the webhook ID when `enable_paypal_webhook` is true, and the two organizer secrets when `enable_organizer_access` is true. It can also call Vertex AI. The Cloud Build service account can write to the Yatalk Artifact Registry repository, read the private build-source bucket, and write Cloud Logging entries. The container image and Cloud Run revision use an immutable image digest.

The deployment has three Terraform applies: prerequisites, a private service to discover its URL, then public access with the exact URL configured. The public invoker binding is disabled by default.

Artifact Analysis vulnerability scanning is enabled for this repository. Google currently charges about $0.26 per automatically scanned image; see the [current pricing](https://cloud.google.com/artifact-analysis/pricing) before building additional images.

1. For a fresh project, apply only the prerequisites from this directory. Leave `enable_cloud_run_service` and `enable_public_access` false (their defaults):

   ```sh
   terraform init
   terraform plan
   terraform apply
   ```

2. Add the PayPal Sandbox values directly to Secret Manager using the authorized 1Password environment. The values travel over stdin and are not placed in Terraform state, shell arguments, or files:

   ```sh
   op run --env-file=.env -- sh -eu -c '
   printf %s "$PAYPAL_CLIENT_ID" | gcloud secrets versions add yatalk-paypal-sandbox-client-id --project=s-yatalk --data-file=-
   printf %s "$PAYPAL_CLIENT_SECRET" | gcloud secrets versions add yatalk-paypal-sandbox-client-secret --project=s-yatalk --data-file=-
   '
   ```

   After the public service is ready, register `https://<cloud-run-service-uri>/api/webhooks/paypal` with the PayPal Sandbox REST app and subscribe only to `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.CAPTURE.REFUNDED`. Add the returned webhook ID as a version of `yatalk-paypal-sandbox-webhook-id` using stdin. Generate `yatalk-admin-access-code` (at least 16 random characters) and `yatalk-admin-session-secret` (at least 32 random bytes) the same way. Never put these values in `.tfvars` or Terraform state. Set `enable_paypal_webhook` and `enable_organizer_access` true only after the corresponding Secret Manager versions exist. Retrieve the organizer access code directly with `gcloud secrets versions access latest --secret=yatalk-admin-access-code --project=s-yatalk` when signing in.

3. From the repository root, build and push the container with Cloud Build. The `.gcloudignore` and `.dockerignore` exclude `.env`, environment files, Terraform, state, local databases, and installed dependencies. This only builds an image; Terraform remains the deployment source of truth.

   ```sh
   BUILD_TAG="preview-$(date -u +%Y%m%d%H%M%S)"
   gcloud builds submit . \
     --project=s-yatalk \
     --region=asia-northeast1 \
     --service-account=projects/s-yatalk/serviceAccounts/yatalk-dev-cloud-build@s-yatalk.iam.gserviceaccount.com \
     --gcs-source-staging-dir=gs://yatalk-dev-build-s-yatalk/source \
     --substitutions="_IMAGE_TAG=${BUILD_TAG}"
   ```

   Copy the ID printed by the successful build, then read its digest:

   ```sh
   gcloud builds describe BUILD_ID \
     --project=s-yatalk \
     --region=asia-northeast1 \
     --format='value(results.images[0].digest)'
   ```

   Create or update `prd.auto.tfvars` in this directory with that digest-pinned image and private service enabled:

   ```hcl
   enable_cloud_run_service = true
   enable_public_access     = false
   container_image          = "asia-northeast1-docker.pkg.dev/s-yatalk/yatalk-dev/yatalk@sha256:<64-character-digest>"
   ```

   Apply from this directory and read `terraform output -raw cloud_run_preview_uri`. At this point the service is private and has no public invoker binding.

4. Put that exact URI in the same non-secret `prd.auto.tfvars` file as `app_origin`, enable public access, and apply again. This `APP_ORIGIN` controls the exact browser Origin accepted by the API; Terraform verifies it matches the service URI before granting `allUsers` the Cloud Run Invoker role.

   ```hcl
   enable_cloud_run_service = true
   enable_public_access     = true
   container_image          = "asia-northeast1-docker.pkg.dev/s-yatalk/yatalk-dev/yatalk@sha256:<64-character-digest>"
   app_origin               = "https://<exact-cloud-run-service-uri>"
   ```

   ```sh
   terraform plan
   terraform apply
   ```

The image build requires an authenticated `gcloud` user who can create Cloud Build builds and act as the dedicated build service account. Do not run `gcloud run deploy`; Terraform creates and updates the service. Never put PayPal values in `.tfvars`, substitutions, or Terraform configuration.
