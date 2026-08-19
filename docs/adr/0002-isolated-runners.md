# ADR-0002：双臂必须使用独立子进程

状态：已采纳

## 决策

Control 与 Candidate 不在同一个 DSH/Cordis 进程加载。控制器为每一臂创建独立 `DSH_HOME`、profile、workspace、session root 和环境快照，再以 argv 数组启动子进程。

## 理由

Cordis 插件可能注册服务、事件、工具、定时器或全局状态；同进程切换无法可靠证明卸载完整，也会让模块缓存和副作用跨臂泄漏。进程隔离提供清晰的启动、退出、超时和证据边界。

## 后果

启动成本进入效率指标。timeout/provider outage/corrupt fixture 属于 infrastructure failure，可使 pair 无效，而不是 Candidate 失败。
