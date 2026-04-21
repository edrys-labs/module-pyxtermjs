# Edrys-Development-Environment

This folder contains a Linux development environment based on the base `edryslabs/module-pyxtermjs:base` image.
You can modify the `Dockerfile` to add additional packages or change the configuration.
Start and build it via:

``` bash
$ docker-compose up --build
```

or directly load our prebuild image from dockerhub:

``` bash
$ docker run -it -p 5000:5000 edryslabs/module-pyxtermjs:development
```

