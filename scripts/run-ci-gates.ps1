param(
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "Step failed: $Name (exit code $LASTEXITCODE)"
    }
    Write-Host "PASS: $Name" -ForegroundColor Green
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot

try {
    $python = "python"
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $python = "py -3.10"
    }

    Write-Host "Running local CI gate checks from: $repoRoot" -ForegroundColor Yellow
    Write-Host "SkipInstall: $SkipInstall" -ForegroundColor Yellow

    if (-not $SkipInstall) {
        Invoke-Step "Install pipeline test dependencies" {
            Invoke-Expression "$python -m pip install --upgrade pip"
            Invoke-Expression "$python -m pip install -r pipeline_client/backend/requirements.txt"
            Invoke-Expression "$python -m pip install pytest pytest-asyncio httpx"
        }

        Invoke-Step "Install races-api test dependencies" {
            Push-Location "services/races-api"
            try {
                Invoke-Expression "$python -m pip install --upgrade pip"
                Invoke-Expression "$python -m pip install -r requirements.txt"
                Invoke-Expression "$python -m pip install -r test-requirements.txt"
            }
            finally {
                Pop-Location
            }
        }

        Invoke-Step "Install web dependencies" {
            Push-Location "web"
            try {
                npm ci
            }
            finally {
                Pop-Location
            }
        }
    }

    Invoke-Step "Pipeline tests (tests/)" {
        $env:PYTHONPATH = "."
        Invoke-Expression "$python -m pytest tests -v"
    }

    Invoke-Step "Races API tests" {
        Push-Location "services/races-api"
        try {
            $env:PYTHONPATH = "../.."
            Invoke-Expression "$python -m pytest test_races_api.py -v"
        }
        finally {
            Pop-Location
        }
    }

    Invoke-Step "Web type check" {
        Push-Location "web"
        try {
            npm run check
        }
        finally {
            Pop-Location
        }
    }

    Invoke-Step "Web build" {
        Push-Location "web"
        try {
            npm run build
        }
        finally {
            Pop-Location
        }
    }

    Invoke-Step "Web unit tests" {
        Push-Location "web"
        try {
            npm run test:unit -- --run
        }
        finally {
            Pop-Location
        }
    }

    Invoke-Step "Terraform format check" {
        Push-Location "infra"
        try {
            terraform fmt -check -recursive
        }
        finally {
            Pop-Location
        }
    }

    Invoke-Step "Terraform validate" {
        Push-Location "infra"
        try {
            terraform init -backend=false
            terraform validate
        }
        finally {
            Pop-Location
        }
    }

    Write-Host ""
    Write-Host "All CI gate checks passed." -ForegroundColor Green
    exit 0
}
catch {
    Write-Host ""
    Write-Host "CI gate checks failed." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
finally {
    Pop-Location
}
