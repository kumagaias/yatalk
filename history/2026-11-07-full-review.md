# Full review and release checks

- Goal: review the shop, checkout, voice, and PRD deployment paths and verify behavior before release.
- Findings: concurrent retries after an uncertain PayPal order creation could overlap; serialize them behind the existing in-flight guard. A microphone permission request resolving after chat unmount could start recording on a departed page; stop the granted stream instead.
- Infrastructure: manage the Cloud Resource Manager API in Terraform and document the ADC quota-project setting required when credentials point elsewhere.
- Checks: 69 unit and integration tests passed; production build passed; isolated headless Chrome confirmed the late microphone grant stopped its audio track without starting a recorder. Terraform 1.17.1 format, validation, and refreshed plan passed after the API prerequisite was applied.
- Release: rebuild and scan the final committed image, then apply it through Terraform and verify the public health endpoint.
