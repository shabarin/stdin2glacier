# stdin2glacier
Anything from your stdin ====> Amazon Glacier

## usage example
Tar, gzip & upload to aws glacier:
```
tar zc mydir | stdin2glacier - -r eu-central-1 -v myvault -d "The mydir archive" -s 8   
```

### stdin2glacier --help
```
  Usage: stdin2glacier [options] <file> (use `-` for stdin)

  Options:

    -h, --help                       output usage information
    -V, --version                    output the version number
    -s, --part-size <part-size>      Part size (in Mb) to use during upload (can be 2^n, defaults to 1)
    -r, --region <region>            AWS region (e.g. eu-central-1)
    -v, --vault-name <vault-name>    Vault name
    -d, --description <description>  Archive description
    -k, --skip-parts <skip-parts>    Retry upload but skip all previously uploaded parts before given part number
```

## requirements
Nodejs 4+
You also should have AWS credentials in your `~/.aws/credentials` file:

```
[default]
aws_access_key_id = <...>
aws_secret_access_key = <...>
```

## installation
`npm install -g stdin2glacier`