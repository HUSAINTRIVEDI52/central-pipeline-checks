# CI/CD Security Pipeline

## Port Reference

| Service            | Port | Location              |
|--------------------|------|-----------------------|
| SonarQube          | 9000 | GCP Sandbox Server    |
| DefectDojo         | 8080 | GCP Sandbox Server    |
| OWASP ZAP          | N/A  | GitHub Actions runner |
| OWASP Dep-Check    | N/A  | GitHub Actions runner |
| Express App (ZAP)  | 3000 | GitHub Actions runner |

## Folder Structure

```
your-repo/
├── .github/
│   ├── workflows/
│   │   └── security-pipeline.yml   ← Main pipeline — all 6 jobs
│   ├── scripts/
│   │   ├── check-dns.sh            ← No-IP DNS health check + retry
│   │   ├── wait-for-app.sh         ← Polls localhost:3000 until ready
│   │   └── import-to-defectdojo.sh ← Uploads report to DefectDojo API
│   └── security/
│       └── zap/
│           └── zap-rules.tsv       ← ZAP alert rule config (WARN/IGNORE)
├── security/
│   ├── sonarqube/
│   │   └── sonar-project.properties ← SonarQube project config
│   ├── zap/                         ← ZAP output reports (generated)
│   ├── dependency-check/            ← Dep-Check output (generated)
│   └── defectdojo/                  ← DefectDojo config notes
├── reports/                         ← All generated reports land here
│   └── .gitkeep
└── sonar-project.properties         ← Copy of sonar config at root (required)
```

## Required GitHub Secrets (sandbox environment)

| Secret                    | Used By     |
|---------------------------|-------------|
| SONAR_HOST_URL            | Job 2       |
| SONAR_TOKEN               | Job 2       |
| SONAR_PROJECT_KEY         | Job 2       |
| NVD_API_KEY               | Job 3       |
| ZAP_TARGET_URL            | Job 4 (localhost:3000) |
| DEFECTDOJO_URL            | Jobs 5 + 6  |
| DEFECTDOJO_API_KEY        | Jobs 5 + 6  |
| DEFECTDOJO_PRODUCT_ID     | Jobs 5 + 6  |
| DEFECTDOJO_ENGAGEMENT_ID  | Jobs 5 + 6  |

## Pipeline Jobs

| Job                  | Depends On          | continue-on-error |
|----------------------|---------------------|--------------------|
| setup                | —                   | No                 |
| sonarqube-scan       | setup               | Yes                |
| dependency-check     | setup               | Yes                |
| zap-scan             | setup               | Yes                |
| import-to-defectdojo | all 3 scans         | No                 |
| generate-report      | import-to-defectdojo| No                 |

## Setup Steps Before Running

1. Install No-IP DUC on GCP VM and start: `sudo systemctl enable noip2`
2. Create No-IP hostnames for SonarQube (:9000) and DefectDojo (:8080)
3. Get free NVD API key from nvd.nist.gov/developers/request-an-api-key
4. Create DefectDojo Product + Engagement, note their IDs
5. Create SonarQube project, note Project Key and generate Analysis Token
6. Create GitHub Environment named `sandbox` and add all 9 secrets
7. Copy `security/sonarqube/sonar-project.properties` to repo root
8. Make scripts executable: `chmod +x .github/scripts/*.sh`
