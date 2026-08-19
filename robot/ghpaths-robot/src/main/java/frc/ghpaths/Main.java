package frc.ghpaths;

import edu.wpi.first.wpilibj.RobotBase;

/** GHPaths 机器人入口（WPILib 标准模板）。 */
public final class Main {
    private Main() {}

    public static void main(String... args) {
        RobotBase.startRobot(Robot::new);
    }
}
